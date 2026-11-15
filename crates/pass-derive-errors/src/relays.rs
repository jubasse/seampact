//! Relay codes (ADR 0002 section 7, ADR 0006 sections 3 and 5, row `relay.route`): a relay route
//! copies the domain codes of the public operation it relays (node and pack attachments,
//! `notFound`, and the codes that operation copied in turn), each with its declaration. The
//! boundary codes it derives itself under its own bindings, and the gateway's own (access,
//! api-wide) are not copied. A copied declaration joins this api's `errors` with its origin in the
//! public api (`api` naming it), and its contract nature joins `natures`; a code or nature this api
//! already declares, or another relay route copied first, must hold the same declaration
//! (everything but the origin), else it is refused at the route's `relays`, naming both. A copied
//! declaration's params schema is tree.schemas' to copy: one this api lacks is refused. An imported
//! api's declarations are compared only: this compiler narrows no imported error declaration yet,
//! so a domain code this api lacks is refused instead of copied.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;

use indexmap::IndexMap;
use seampact_diagnostics::{InternalError, quote_text};
use seampact_ir::{
    DerivationId, ErrorCode, ErrorDecl, ErrorRoleBinding, IrClosedCheck, IrMap, NatureDecl,
    NatureId, Operation, OperationError, OperationId, OperationRef, Origin, Schema, SchemaId,
    check_ir_closed_declaration,
};
use seampact_json::{JsonValue, canonical_json};
use seampact_pass_tree_shared::{TREE_NODES_OPERATION_KIND, tree_nodes_relay_origin};
use seampact_pipeline::{DraftOperation, pointer_below};

use crate::registry::{DeriveErrorsRegistered, DeriveErrorsRegistry};
use crate::report::{
    DeriveErrorsProblem, DeriveErrorsRelated, DeriveErrorsReporter, DeriveErrorsRule,
};
use crate::triggers::DeriveErrorsRoute;

/// The derivation of a code a relay route copies.
pub(crate) const DERIVE_ERRORS_RELAY_DERIVATION: DerivationId =
    DerivationId::from_static("relay.route");

const PACK_DERIVATION_PREFIX: &str = "pack.";

/// The derivations of a domain code besides the relay's own.
const OTHER_DOMAIN_DERIVATIONS: [&str; 3] = ["member.notFound", "owner.caller", "node.errors"];

/// A domain code a relay route copies from the public operation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DeriveErrorsRelayCode {
    pub(crate) code: ErrorCode,
    pub(crate) from: Vec<Origin>,
    pub(crate) example: Option<JsonValue>,
    pub(crate) roles: Option<Vec<ErrorRoleBinding>>,
    /// The public element's origin in its api, for a code attached there.
    pub(crate) origin: Option<Origin>,
}

/// What the relay routes copy: the declarations and natures this api lacks, and each route's codes
/// by its id.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct DeriveErrorsRelayCopies {
    pub(crate) errors: IndexMap<ErrorCode, DeriveErrorsRegistered>,
    pub(crate) natures: IndexMap<NatureId, NatureDecl>,
    pub(crate) codes: HashMap<OperationId, Vec<DeriveErrorsRelayCode>>,
}

/// What the relay copy reads.
#[derive(Clone, Copy)]
pub(crate) struct DeriveErrorsRelaySources<'sources> {
    pub(crate) registry: &'sources DeriveErrorsRegistry,
    pub(crate) natures: &'sources IndexMap<NatureId, NatureDecl>,
    pub(crate) schemas: &'sources IrMap<SchemaId, Schema>,
}

/// A declaration as compared: an error or a nature.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Declaration<'declaration> {
    Error(&'declaration ErrorDecl),
    Nature(&'declaration NatureDecl),
}

/// The public operation and the catalogues its codes are declared in: a workspace api's derived
/// draft, or an import.
#[derive(Debug, Clone)]
pub(crate) enum PublicSide<'run> {
    Relayed {
        api: String,
        operation: &'run DraftOperation,
        errors: &'run IrMap<ErrorCode, ErrorDecl>,
        natures: &'run IrMap<NatureId, NatureDecl>,
    },
    Imported {
        api: String,
        operation: &'run Operation,
        errors: &'run IrMap<ErrorCode, ErrorDecl>,
    },
}

impl<'run> PublicSide<'run> {
    fn api(&self) -> &str {
        match self {
            Self::Relayed { api, .. } | Self::Imported { api, .. } => api,
        }
    }

    fn errors(&self) -> &'run IrMap<ErrorCode, ErrorDecl> {
        match self {
            Self::Relayed { errors, .. } | Self::Imported { errors, .. } => errors,
        }
    }

    fn operation_origin(&self) -> Option<&'run Origin> {
        match self {
            Self::Relayed { operation, .. } => operation.origin.as_ref(),
            Self::Imported { operation, .. } => Some(&operation.origin),
        }
    }

    fn operation_errors(&self) -> &'run [OperationError] {
        match self {
            Self::Relayed { operation, .. } => operation.errors.as_deref().unwrap_or_default(),
            Self::Imported { operation, .. } => &operation.errors,
        }
    }
}

/// One relay route's copy: where it is reported and what it relays.
#[derive(Debug, Clone)]
struct RelaySite {
    pointer: String,
    relays: String,
}

#[derive(Debug, Clone)]
struct FirstCopy<'declaration> {
    declaration: Declaration<'declaration>,
    site: RelaySite,
}

fn is_domain_code(error: &OperationError) -> bool {
    let Some(derived_from) = &error.derived_from else {
        return false;
    };
    let derivation = &derived_from.derivation;

    OTHER_DOMAIN_DERIVATIONS.contains(&derivation.as_str())
        || *derivation == DERIVE_ERRORS_RELAY_DERIVATION
        || derivation.as_str().starts_with(PACK_DERIVATION_PREFIX)
}

// What two declarations of one name must agree on: everything but the origin, which names each
// api's file.
fn content_of(declaration: Declaration<'_>) -> Result<String, InternalError> {
    let encoded = match declaration {
        Declaration::Error(error) => serde_json::to_value(error),
        Declaration::Nature(nature) => serde_json::to_value(nature),
    }
    .map_err(|failure| {
        InternalError::new(format!(
            "derive.errors cannot encode a declaration to compare: {failure}"
        ))
    })?;
    let mut content = JsonValue::try_from(encoded).map_err(|failure| {
        InternalError::new(format!(
            "derive.errors holds a declaration that is no JSON value: {failure}"
        ))
    })?;

    if let JsonValue::Object(members) = &mut content {
        members.remove("origin");
    }

    Ok(canonical_json(&content))
}

fn entry_of<'catalogue, K, V>(
    catalogue: &'catalogue IrMap<K, V>,
    id: &str,
    what: &str,
) -> Result<&'catalogue V, InternalError>
where
    K: AsRef<str> + Borrow<str> + Eq + Hash,
{
    catalogue.get(id).ok_or_else(|| {
        InternalError::new(format!(
            "{what} {id} is not declared in the api that names it"
        ))
    })
}

fn public_side<'run>(
    reporter: &DeriveErrorsReporter<'_, 'run>,
    relays: &OperationRef,
) -> Result<PublicSide<'run>, InternalError> {
    let api = relays.api.as_str();
    let id = &relays.id;
    let relayed = reporter.relayed(api);
    let from_draft = relayed.and_then(|draft| {
        draft
            .operations
            .iter()
            .find(|candidate| {
                candidate.kind.as_ref() == Some(&TREE_NODES_OPERATION_KIND)
                    && candidate.id.as_ref() == Some(id)
            })
            .map(|operation| (draft, operation))
    });

    if let Some((draft, operation)) = from_draft {
        return Ok(PublicSide::Relayed {
            api: api.to_owned(),
            operation,
            errors: &draft.errors,
            natures: &draft.natures,
        });
    }

    let imported = reporter.imported(api);
    let found = imported.and_then(|contract| {
        contract
            .operations
            .iter()
            .enumerate()
            .find(|(_, candidate)| {
                candidate.kind == TREE_NODES_OPERATION_KIND && candidate.id == *id
            })
            .map(|(index, operation)| (contract, index, operation))
    });
    let closed = found
        .map(|(contract, index, operation)| {
            check_ir_closed_declaration(operation, &format!("/operations/{index}"))
                .map(|check| (contract, check))
        })
        .transpose()
        .map_err(|error| InternalError::new(error.to_string()))?;

    if let Some((contract, IrClosedCheck::Closed(operation))) = closed {
        return Ok(PublicSide::Imported {
            api: api.to_owned(),
            operation,
            errors: &contract.errors,
        });
    }

    Err(InternalError::new(format!(
        "a relay route relays {api}.{id}, which tree.nodes found but is no closed operation of {api}"
    )))
}

struct RelayCopier<'sources, 'run> {
    sources: DeriveErrorsRelaySources<'sources>,
    copies: DeriveErrorsRelayCopies,
    first_errors: HashMap<String, FirstCopy<'run>>,
    first_natures: HashMap<String, FirstCopy<'run>>,
}

impl<'sources, 'run> RelayCopier<'sources, 'run> {
    fn new(sources: DeriveErrorsRelaySources<'sources>) -> Self {
        Self {
            sources,
            copies: DeriveErrorsRelayCopies::default(),
            first_errors: HashMap::new(),
            first_natures: HashMap::new(),
        }
    }

    fn copy_route(
        &mut self,
        route: &DeriveErrorsRoute<'_>,
        relays: &OperationRef,
        reporter: &mut DeriveErrorsReporter<'_, 'run>,
    ) -> Result<(), InternalError> {
        let public = public_side(reporter, relays)?;
        let site = RelaySite {
            pointer: pointer_below(&route.node.pointer, &["relays"]),
            relays: format!("{}.{}", relays.api, relays.id),
        };
        let Some(public_origin) = public.operation_origin() else {
            return Err(InternalError::new(format!(
                "the relayed operation {} has no origin",
                site.relays
            )));
        };
        let from = vec![tree_nodes_relay_origin(public_origin, public.api())];
        let mut codes = Vec::new();

        for error in public.operation_errors() {
            if !is_domain_code(error)
                || !self.join_declaration(&public, &site, error.code.as_str(), reporter)?
            {
                continue;
            }

            codes.push(DeriveErrorsRelayCode {
                code: error.code.clone(),
                from: from.clone(),
                example: error.example.clone(),
                roles: error.roles.clone(),
                origin: error
                    .origin
                    .as_ref()
                    .map(|origin| tree_nodes_relay_origin(origin, public.api())),
            });
        }

        self.copies.codes.insert(route.id.clone(), codes);

        Ok(())
    }

    // Whether the code's declaration is this api's, the same as one already copied, or copied now.
    fn join_declaration(
        &mut self,
        public: &PublicSide<'run>,
        site: &RelaySite,
        code: &str,
        reporter: &mut DeriveErrorsReporter<'_, 'run>,
    ) -> Result<bool, InternalError> {
        let relayed = entry_of(
            public.errors(),
            code,
            &format!("the error of {}", site.relays),
        )?;
        let what = format!("error {}", quote_text(code));

        if let Some(local) = self.sources.registry.get(code) {
            return Self::same_as_local(
                site,
                &what,
                Declaration::Error(relayed),
                Declaration::Error(&local.declaration),
                local.pointer.as_deref(),
                reporter,
            );
        }

        if let Some(first) = self.first_errors.get(code) {
            return Self::same_as_first(site, &what, Declaration::Error(relayed), first, reporter);
        }

        let PublicSide::Relayed { api, natures, .. } = public else {
            reporter.error(DeriveErrorsProblem {
                rule: DeriveErrorsRule::RelayDeclaration,
                message: format!(
                    "error {}, which {} answers, is declared in the imported api {} only, and this compiler does not copy an imported error declaration",
                    quote_text(code),
                    site.relays,
                    public.api()
                ),
                fix: format!(
                    "declare {} in this api with the same definition as in {}",
                    quote_text(code),
                    public.api()
                ),
                pointer: site.pointer.clone(),
                related: Vec::new(),
            })?;

            return Ok(false);
        };

        if !self.params_join(site, relayed, reporter)?
            || !self.nature_joins(api, natures, site, relayed, reporter)?
        {
            return Ok(false);
        }

        self.first_errors.insert(
            code.to_owned(),
            FirstCopy {
                declaration: Declaration::Error(relayed),
                site: site.clone(),
            },
        );
        self.copies.errors.insert(
            ErrorCode::new(code.to_owned()),
            DeriveErrorsRegistered {
                declaration: ErrorDecl {
                    origin: tree_nodes_relay_origin(&relayed.origin, api),
                    ..relayed.clone()
                },
                pointer: None,
            },
        );

        Ok(true)
    }

    fn params_join(
        &self,
        site: &RelaySite,
        declaration: &ErrorDecl,
        reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, InternalError> {
        let Some(params) = &declaration.params else {
            return Ok(true);
        };

        if self.sources.schemas.contains_key(params.as_str()) {
            return Ok(true);
        }

        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::RelayDeclaration,
            message: format!(
                "error {}, which {} answers, has the params schema {}, which this api does not declare",
                quote_text(declaration.code.as_str()),
                site.relays,
                quote_text(params.as_str())
            ),
            fix: format!(
                "declare {} in a shared file both apis load",
                quote_text(params.as_str())
            ),
            pointer: site.pointer.clone(),
            related: Vec::new(),
        })?;

        Ok(false)
    }

    fn nature_joins(
        &mut self,
        api: &str,
        natures: &'run IrMap<NatureId, NatureDecl>,
        site: &RelaySite,
        declaration: &ErrorDecl,
        reporter: &mut DeriveErrorsReporter<'_, 'run>,
    ) -> Result<bool, InternalError> {
        let Some(id) = &declaration.nature_name else {
            return Ok(true);
        };
        let nature = entry_of(
            natures,
            id.as_str(),
            &format!("the nature of error {}", declaration.code),
        )?;
        let what = format!("nature {}", quote_text(id.as_str()));

        if let Some(local) = self.sources.natures.get(id.as_str()) {
            return Self::same_as_local(
                site,
                &what,
                Declaration::Nature(nature),
                Declaration::Nature(local),
                Some(&local.origin.pointer),
                reporter,
            );
        }

        if let Some(first) = self.first_natures.get(id.as_str()) {
            return Self::same_as_first(site, &what, Declaration::Nature(nature), first, reporter);
        }

        self.first_natures.insert(
            id.as_str().to_owned(),
            FirstCopy {
                declaration: Declaration::Nature(nature),
                site: site.clone(),
            },
        );
        self.copies.natures.insert(
            id.clone(),
            NatureDecl {
                origin: tree_nodes_relay_origin(&nature.origin, api),
                ..nature.clone()
            },
        );

        Ok(true)
    }

    // A local declaration without a pointer is a core one, located at the relay route alone.
    fn same_as_local(
        site: &RelaySite,
        what: &str,
        relayed: Declaration<'_>,
        local: Declaration<'_>,
        local_pointer: Option<&str>,
        reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, InternalError> {
        if content_of(relayed)? == content_of(local)? {
            return Ok(true);
        }

        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::RelayDeclaration,
            message: format!(
                "the {what} that {} answers differs from the one this api declares",
                site.relays
            ),
            fix: "declare it once in a shared file both apis load, or rename one of them"
                .to_owned(),
            pointer: site.pointer.clone(),
            related: local_pointer
                .map(|pointer| DeriveErrorsRelated {
                    pointer: pointer.to_owned(),
                    message: format!("this api's {what}"),
                })
                .into_iter()
                .collect(),
        })?;

        Ok(false)
    }

    fn same_as_first(
        site: &RelaySite,
        what: &str,
        relayed: Declaration<'_>,
        first: &FirstCopy<'_>,
        reporter: &mut DeriveErrorsReporter<'_, '_>,
    ) -> Result<bool, InternalError> {
        if content_of(relayed)? == content_of(first.declaration)? {
            return Ok(true);
        }

        reporter.error(DeriveErrorsProblem {
            rule: DeriveErrorsRule::RelayDeclaration,
            message: format!(
                "the {what} that {} answers differs from the one {} answers",
                site.relays, first.site.relays
            ),
            fix: "declare it once in a shared file both public apis load, or rename one of them"
                .to_owned(),
            pointer: site.pointer.clone(),
            related: vec![DeriveErrorsRelated {
                pointer: first.site.pointer.clone(),
                message: format!("the route relaying {}", first.site.relays),
            }],
        })?;

        Ok(false)
    }
}

/// The domain codes every relay route copies, with the declarations and natures this api lacks.
///
/// # Errors
///
/// An internal error when a relayed operation or declaration cannot be read.
pub(crate) fn derive_errors_relay_copies(
    sources: DeriveErrorsRelaySources<'_>,
    routes: &[DeriveErrorsRoute<'_>],
    reporter: &mut DeriveErrorsReporter<'_, '_>,
) -> Result<DeriveErrorsRelayCopies, InternalError> {
    let mut copier = RelayCopier::new(sources);

    for route in routes {
        if let Some(relays) = &route.operation.relays {
            copier.copy_route(route, relays, reporter)?;
        }
    }

    Ok(copier.copies)
}
