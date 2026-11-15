//! The rule proofs of a route: the header params and body fields its rules read, and the input a
//! proof-only route gets (ADR 0002 section 9, "Proofs").

use indexmap::{IndexMap, IndexSet};
use seampact_diagnostics::InternalError;
use seampact_ir::{
    DerivationId, DerivedFrom, FieldWire, Identity, IdentityId, InputMediaType, InputProof, IrMap,
    KnownIdentityRef, KnownRequirementRef, KnownSchemeRef, Origin, Param, ProofPlacement,
    Requirement, RuleProof, Scheme, SchemeId, SignedIdentity, UnknownKeys,
};
use seampact_pipeline::{DraftOperationInput, PassError, pointer_below};

use crate::catalogues::AccessRightsCatalogues;
use crate::not_ported::not_ported_yet;
use crate::read::access_rights_origin_of;
use crate::report::AccessRightsReporter;
use crate::restricted_fields::AccessRightsDraftSchemas;
use crate::routes::{AccessRightsRoute, access_rights_operation_of};
use crate::schema_use::AccessRightsContext;

/// What one route's proofs need besides the catalogues.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsProofsInput<'draft> {
    pub(crate) route: AccessRightsRoute,
    /// The route's checked requirements, in order.
    pub(crate) requires: Vec<Requirement>,
    pub(crate) schemas: &'draft AccessRightsDraftSchemas,
    pub(crate) identities: &'draft IrMap<IdentityId, Identity>,
    pub(crate) schemes: &'draft IrMap<SchemeId, Scheme>,
}

/// The proofs of one route.
#[derive(Debug, Clone)]
pub(crate) struct AccessRightsProofs {
    pub(crate) headers: Vec<Param>,
    pub(crate) proofs: Vec<InputProof>,
    pub(crate) created_input: Option<DraftOperationInput>,
    pub(crate) refused_body_proofs: Vec<String>,
}

/// A header the route already takes: its name, the role that takes it and where it is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RouteHeader {
    pub(crate) name: String,
    pub(crate) role: String,
    pub(crate) pointer: String,
}

/// One use of a rule's proof by a requirement.
#[derive(Debug, Clone)]
pub(crate) struct ProofUse {
    pub(crate) rule: String,
    pub(crate) proof: RuleProof,
    pub(crate) use_pointer: String,
    pub(crate) proof_pointer: String,
    pub(crate) from: Vec<Origin>,
}

const PROOF_DERIVATION: DerivationId = DerivationId::from_static("rule.proof");

const UNKNOWN_KEYS_DERIVATION: DerivationId = DerivationId::from_static("identity.unknownKeys");

const PROOF_ONLY_MEDIA: &str = "application/json";

const EMPTY_BODY_SCHEMA: &str = "ApiEmptyBody";

const AUTHORIZATION_HEADER: &str = "Authorization";

const SIGNED_INPUT_FIX: &str = "declare `input`";

const SIGNED_GET_FIX: &str =
    "serve the signed deliveries on a route with a body (a `post` with `input`)";

/// The media types of a body with fields (form and multipart), which carry no body proof.
const FIELD_MEDIA: &[InputMediaType] = &[
    InputMediaType::ApplicationXWwwFormUrlencoded,
    InputMediaType::MultipartFormData,
];

/// The proofs of one route: header params, body proofs and the input a proof-only route gets.
///
/// # Errors
///
/// An internal error, or a [`PassError::NotPortedYet`] from a builder.
pub(crate) fn access_rights_proofs(
    context: &AccessRightsContext,
    reporter: &mut AccessRightsReporter,
    catalogues: &AccessRightsCatalogues,
    input: &AccessRightsProofsInput<'_>,
) -> Result<AccessRightsProofs, PassError> {
    let uses = proof_uses(context, catalogues, &input.requires)?;
    let taken_headers = route_headers(context, input)?;
    let mut headers = Vec::new();
    let mut header_uses = Vec::new();

    for header_use in shared_by_name(reporter, &input.route, &uses, &ProofPlacement::Header)? {
        if !takes_route_header(reporter, &input.route, &taken_headers, &header_use)? {
            header_uses.push(header_use);
        }
    }

    for header_use in &header_uses {
        headers.push(header_param_of(header_use));
    }

    let body_uses = shared_by_name(reporter, &input.route, &uses, &ProofPlacement::Body)?;
    let declared = access_rights_operation_of(context, &input.route)?
        .input
        .as_ref();
    let identity = signed_identity_of(input)?;
    let refused_body_proofs: Vec<String> = body_uses
        .iter()
        .map(|body_use| body_use.proof.name.clone())
        .collect();

    if body_uses.is_empty() {
        if let (None, Some(identity)) = (declared, identity) {
            report_signed_without_input(reporter, &input.route, identity)?;
        }

        return Ok(AccessRightsProofs {
            headers,
            proofs: Vec::new(),
            created_input: None,
            refused_body_proofs: Vec::new(),
        });
    }

    let refused = AccessRightsProofs {
        headers,
        proofs: Vec::new(),
        created_input: None,
        refused_body_proofs,
    };

    let Some(declared) = declared else {
        let created = created_input(reporter, input, &body_uses, identity)?;

        return Ok(match created {
            None => refused,
            Some(created) => AccessRightsProofs {
                created_input: Some(created),
                refused_body_proofs: Vec::new(),
                ..refused
            },
        });
    };

    if !fits_declared_input(reporter, input, declared, &body_uses)? {
        return Ok(refused);
    }

    let field_media = FIELD_MEDIA.contains(&declared.media);
    let mut proofs = Vec::with_capacity(body_uses.len());

    for body_use in &body_uses {
        let mut proof = input_proof_of(body_use);

        if field_media {
            proof.wire = Some(proof_wire(context, body_use)?);
        }

        proofs.push(proof);
    }

    Ok(AccessRightsProofs {
        proofs,
        refused_body_proofs: Vec::new(),
        ..refused
    })
}

/// The proof of each rule the requirements use, with the origins of its use and its declaration.
///
/// # Errors
///
/// An internal error for a rule requirement with no origin.
pub(crate) fn proof_uses(
    context: &AccessRightsContext,
    catalogues: &AccessRightsCatalogues,
    requires: &[Requirement],
) -> Result<Vec<ProofUse>, PassError> {
    let mut uses = Vec::new();

    for requirement in requires {
        let KnownRequirementRef::Rule(rule) = KnownRequirementRef::try_from(requirement)? else {
            continue;
        };
        let Some(proof) = catalogues
            .rules
            .get(&rule.rule)
            .and_then(|declared| declared.proof.as_ref())
        else {
            continue;
        };

        let mut origins = requirement_origins(requirement)?;
        let proof_pointer = pointer_below("/rules", &[rule.rule.as_str(), "proof"]);
        let Some(first) = origins.first() else {
            return Err(InternalError::new(format!(
                "access.rights built a requirement on rule '{}' with no origin",
                rule.rule
            ))
            .into());
        };
        let use_pointer = first.pointer.clone();

        origins.push(access_rights_origin_of(context, &proof_pointer)?);
        uses.push(ProofUse {
            rule: rule.rule.as_str().to_owned(),
            proof: proof.clone(),
            use_pointer,
            proof_pointer,
            from: origins,
        });
    }

    Ok(uses)
}

/// The origins of a requirement: a written one has its origin, a pack-derived one the origins of
/// its derivation, the pack entry first.
///
/// # Errors
///
/// An internal error for a requirement of a kind this revision does not know.
pub(crate) fn requirement_origins(requirement: &Requirement) -> Result<Vec<Origin>, InternalError> {
    let (origin, derived_from) = match KnownRequirementRef::try_from(requirement)? {
        KnownRequirementRef::Right(right) => (&right.origin, &right.derived_from),
        KnownRequirementRef::Rule(rule) => (&rule.origin, &rule.derived_from),
    };

    if let Some(origin) = origin {
        return Ok(vec![origin.clone()]);
    }

    Ok(derived_from
        .as_ref()
        .map(|derived_from| derived_from.from.clone())
        .unwrap_or_default())
}

/// Header names are case-insensitive (RFC 9110 section 5.1); a body name is a JSON member name.
pub(crate) fn name_key(placement: &ProofPlacement, name: &str) -> String {
    match placement {
        ProofPlacement::Header => name.to_lowercase(),
        ProofPlacement::Body | ProofPlacement::Unknown(_) => name.to_owned(),
    }
}

/// The uses of one placement merged by name, in requirement order: a later use with the first
/// one's schema adds its origins to it; one with another schema is an error naming both, and adds
/// nothing.
///
/// # Errors
///
/// What the name key and the clash report fail with.
pub(crate) fn shared_by_name(
    reporter: &mut AccessRightsReporter,
    route: &AccessRightsRoute,
    uses: &[ProofUse],
    placement: &ProofPlacement,
) -> Result<Vec<ProofUse>, PassError> {
    let mut by_name: IndexMap<String, ProofUse> = IndexMap::new();

    for use_of in uses {
        if use_of.proof.r#in != *placement {
            continue;
        }

        let key = name_key(placement, &use_of.proof.name);
        let Some(first) = by_name.get_mut(&key) else {
            by_name.insert(key, use_of.clone());

            continue;
        };

        // Typed IR values compare by member, as their canonical texts do.
        if first.proof.schema != use_of.proof.schema {
            report_schema_clash(reporter, route, first, use_of)?;

            continue;
        }

        for origin in &use_of.from {
            if !first.from.contains(origin) {
                first.from.push(origin.clone());
            }
        }
    }

    Ok(by_name.into_values().collect())
}

// The declared request headers, then the credential and CSRF headers of the route identity's
// schemes.
pub(crate) fn route_headers(
    context: &AccessRightsContext,
    input: &AccessRightsProofsInput<'_>,
) -> Result<Vec<RouteHeader>, PassError> {
    let route = &input.route;
    let operation = access_rights_operation_of(context, route)?;
    let node = context.nodes.get(route.node)?;
    let mut headers: Vec<RouteHeader> = operation
        .params
        .iter()
        .flat_map(|params| &params.header)
        .map(|param| RouteHeader {
            name: param.name.clone(),
            role: "a declared header".to_owned(),
            pointer: param
                .origin
                .as_ref()
                .map(|origin| origin.pointer.clone())
                .or_else(|| {
                    let derived_from = param.derived_from.as_ref()?;

                    derived_from
                        .from
                        .first()
                        .map(|origin| origin.pointer.clone())
                })
                .unwrap_or_else(|| node.pointer.clone()),
        })
        .collect();

    for id in identity_scheme_ids(input)? {
        headers.extend(scheme_headers(input.schemes, &id)?);
    }

    Ok(headers)
}

pub(crate) fn identity_scheme_ids(
    input: &AccessRightsProofsInput<'_>,
) -> Result<Vec<String>, InternalError> {
    let Some(name) = &input.route.identity else {
        return Ok(Vec::new());
    };
    let Some(identity) = input.identities.get(name) else {
        return Ok(Vec::new());
    };

    Ok(match KnownIdentityRef::try_from(identity)? {
        KnownIdentityRef::Signed(signed) => vec![signed.signed.as_str().to_owned()],
        KnownIdentityRef::Credential(credential) => {
            let schemes = &credential.schemes;
            let ids: IndexSet<&str> = schemes
                .read
                .iter()
                .chain(&schemes.write)
                .chain(&schemes.optional_read)
                .map(SchemeId::as_str)
                .collect();

            ids.into_iter().map(str::to_owned).collect()
        }
    })
}

/// The headers a scheme makes a route read. `access.identity` resolves every scheme an identity
/// names, so an unknown id is already its error.
///
/// # Errors
///
/// An internal error for a scheme of a kind this revision does not know.
pub(crate) fn scheme_headers(
    schemes: &IrMap<SchemeId, Scheme>,
    id: &str,
) -> Result<Vec<RouteHeader>, InternalError> {
    let Some(scheme) = schemes.get(id) else {
        return Ok(Vec::new());
    };
    let credential = |name: &str, origin: &Origin| {
        vec![RouteHeader {
            name: name.to_owned(),
            role: format!("the credential header of scheme '{id}'"),
            pointer: origin.pointer.clone(),
        }]
    };

    Ok(match KnownSchemeRef::try_from(scheme)? {
        KnownSchemeRef::Bearer(scheme) => credential(AUTHORIZATION_HEADER, &scheme.origin),
        KnownSchemeRef::Basic(scheme) => credential(AUTHORIZATION_HEADER, &scheme.origin),
        KnownSchemeRef::Header(scheme) => credential(&scheme.name, &scheme.origin),
        KnownSchemeRef::Signature(scheme) => scheme
            .name
            .as_ref()
            .map_or_else(Vec::new, |name| credential(name, &scheme.origin)),
        KnownSchemeRef::Cookie(scheme) => match &scheme.csrf {
            Some(csrf) => csrf_headers(schemes, csrf.as_str())?,
            None => Vec::new(),
        },
        KnownSchemeRef::Query(_) => Vec::new(),
    })
}

/// The CSRF header of a cookie scheme, when its `csrf` names a header scheme.
///
/// # Errors
///
/// An internal error for a scheme of a kind this revision does not know.
pub(crate) fn csrf_headers(
    schemes: &IrMap<SchemeId, Scheme>,
    id: &str,
) -> Result<Vec<RouteHeader>, InternalError> {
    let Some(scheme) = schemes.get(id) else {
        return Ok(Vec::new());
    };

    Ok(match KnownSchemeRef::try_from(scheme)? {
        KnownSchemeRef::Header(scheme) => vec![RouteHeader {
            name: scheme.name.clone(),
            role: format!("the CSRF header of scheme '{id}'"),
            pointer: scheme.origin.pointer.clone(),
        }],
        KnownSchemeRef::Bearer(_)
        | KnownSchemeRef::Basic(_)
        | KnownSchemeRef::Signature(_)
        | KnownSchemeRef::Cookie(_)
        | KnownSchemeRef::Query(_) => Vec::new(),
    })
}

pub(crate) fn takes_route_header(
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _taken_headers: &[RouteHeader],
    _use: &ProofUse,
) -> Result<bool, PassError> {
    Err(not_ported_yet("takesRouteHeader"))
}

pub(crate) fn report_schema_clash(
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _first: &ProofUse,
    _later: &ProofUse,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportSchemaClash"))
}

pub(crate) fn derived_from_of(use_of: &ProofUse) -> DerivedFrom {
    DerivedFrom {
        derivation: PROOF_DERIVATION,
        from: use_of.from.clone(),
    }
}

pub(crate) fn header_param_of(use_of: &ProofUse) -> Param {
    Param {
        name: use_of.proof.name.clone(),
        r#type: use_of.proof.schema.clone(),
        required: true,
        wire: None,
        default: None,
        origin: None,
        derived_from: Some(derived_from_of(use_of)),
    }
}

pub(crate) fn input_proof_of(use_of: &ProofUse) -> InputProof {
    InputProof {
        name: use_of.proof.name.clone(),
        schema: use_of.proof.schema.clone(),
        wire: None,
        derived_from: derived_from_of(use_of),
    }
}

pub(crate) fn proof_wire(
    _context: &AccessRightsContext,
    _use: &ProofUse,
) -> Result<FieldWire, PassError> {
    Err(not_ported_yet("proofWire"))
}

pub(crate) fn signed_identity_of<'draft>(
    input: &AccessRightsProofsInput<'draft>,
) -> Result<Option<&'draft SignedIdentity>, InternalError> {
    let Some(name) = &input.route.identity else {
        return Ok(None);
    };
    let Some(identity) = input.identities.get(name) else {
        return Ok(None);
    };

    Ok(match KnownIdentityRef::try_from(identity)? {
        KnownIdentityRef::Signed(signed) => Some(signed),
        KnownIdentityRef::Credential(_) => None,
    })
}

pub(crate) fn report_signed_without_input(
    _reporter: &mut AccessRightsReporter,
    _route: &AccessRightsRoute,
    _identity: &SignedIdentity,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportSignedWithoutInput"))
}

pub(crate) fn created_input(
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsProofsInput<'_>,
    _uses: &[ProofUse],
    _identity: Option<&SignedIdentity>,
) -> Result<Option<DraftOperationInput>, PassError> {
    Err(not_ported_yet("createdInput"))
}

pub(crate) fn identity_unknown_keys(
    _identity: &SignedIdentity,
) -> Result<Option<UnknownKeys>, PassError> {
    Err(not_ported_yet("identityUnknownKeys"))
}

pub(crate) fn fits_declared_input(
    _reporter: &mut AccessRightsReporter,
    _input: &AccessRightsProofsInput<'_>,
    _declared: &DraftOperationInput,
    _uses: &[ProofUse],
) -> Result<bool, PassError> {
    Err(not_ported_yet("fitsDeclaredInput"))
}

#[cfg(test)]
mod name_tests {
    use super::*;

    #[test]
    fn a_header_name_folds_case_and_a_body_name_does_not() {
        assert_eq!(name_key(&ProofPlacement::Header, "X-Token"), "x-token");
        assert_eq!(name_key(&ProofPlacement::Body, "X-Token"), "X-Token");
        // JavaScript's toLowerCase maps U+0130 to "i" and a combining dot, as Rust does.
        assert_eq!(name_key(&ProofPlacement::Header, "\u{130}"), "i\u{307}");
        assert_eq!(name_key(&ProofPlacement::Header, "\u{3a3}"), "\u{3c3}");
        assert_eq!(name_key(&ProofPlacement::Header, "A\u{3a3}"), "a\u{3c2}");
    }
}
