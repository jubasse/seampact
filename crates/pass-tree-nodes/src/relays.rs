//! Relay routes: an operation that copies another api's operation, with the formats and paging styles it needs.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;

use seampact_diagnostics::{
    DiagnosticOrigin, InternalError, RelatedLocation, access_rights_quoted,
};
use seampact_json::JsonValue;
use seampact_ir::{
    ContractIr, DerivationId, DerivedFrom, FormatId, HttpMethod, ImportedIr, IrClosedCheck,
    IrClosedDeclaration, IrMap, Operation, OperationId, OperationRef, Origin, Paging, PagingId,
    PagingStyle, Param, Params, Response, ResponseHeader, SortKey, SurfaceId, ValueSource,
    WireFormat, check_ir_closed_declaration,
};
use seampact_pass_tree_shared::{
    TREE_NODES_OPERATION_KIND, tree_nodes_relay_origin, tree_nodes_text,
};
use seampact_pipeline::{
    DraftConcurrency, DraftIr, DraftOperation, DraftOperationInput, DraftOperationInputRef,
    PassError, pointer_below,
};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_locate,
    tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::pass::TreeNodesScope;

/// The derivation that stamps what a relay route copies.
const RELAY_DERIVATION: DerivationId = DerivationId::from_static("relay.route");
/// The derivations whose responses a relay route copies.
const COPIED_RESPONSE_DERIVATIONS: &[DerivationId] = &[
    DerivationId::from_static("response.format"),
    DerivationId::from_static("batch.read"),
    RELAY_DERIVATION,
];
/// The derivations whose elements a relay route copies.
const COPIED_ELEMENT_DERIVATIONS: &[DerivationId] = &[RELAY_DERIVATION];

/// An operation of a draft another api produced, or of an imported IR, borrowed from the run.
#[derive(Debug, Clone, Copy)]
enum RelayedOperation<'run> {
    Draft(&'run DraftOperation),
    Imported(&'run Operation),
}

impl RelayedOperation<'_> {
    /// The operation's method, as the draft or the IR writes it.
    fn method(&self) -> Option<&HttpMethod> {
        match self {
            Self::Draft(operation) => operation.method.as_ref(),
            Self::Imported(operation) => Some(&operation.method),
        }
    }

    /// The operation's full path, as the draft or the IR writes it.
    fn path(&self) -> Option<&str> {
        match self {
            Self::Draft(operation) => operation.path.as_deref(),
            Self::Imported(operation) => Some(&operation.path),
        }
    }

    fn safe(&self) -> Option<bool> {
        match self {
            Self::Draft(operation) => operation.safe,
            Self::Imported(operation) => Some(operation.safe),
        }
    }

    fn params(&self) -> Option<&Params> {
        match self {
            Self::Draft(operation) => operation.params.as_ref(),
            Self::Imported(operation) => Some(&operation.params),
        }
    }

    /// The request body, in the draft shape.
    fn input(&self) -> Option<DraftOperationInputRef<'_>> {
        match self {
            Self::Draft(operation) => operation.input.as_ref().map(DraftOperationInputRef::from),
            Self::Imported(operation) => operation.input.as_ref().map(DraftOperationInputRef::from),
        }
    }

    fn responses(&self) -> Option<&[Response]> {
        match self {
            Self::Draft(operation) => operation.responses.as_deref(),
            Self::Imported(operation) => Some(&operation.responses),
        }
    }

    fn paging(&self) -> Option<&Paging> {
        match self {
            Self::Draft(operation) => operation.paging.as_ref(),
            Self::Imported(operation) => operation.paging.as_ref(),
        }
    }

    /// The version source and field of the operation's concurrency.
    fn concurrency(&self) -> Option<(&ValueSource, &str)> {
        match self {
            Self::Draft(operation) => operation
                .concurrency
                .as_ref()
                .map(|concurrency| (&concurrency.version, concurrency.field.as_str())),
            Self::Imported(operation) => operation
                .concurrency
                .as_ref()
                .map(|concurrency| (&concurrency.version, concurrency.field.as_str())),
        }
    }

    fn origin(&self) -> Option<&Origin> {
        match self {
            Self::Draft(operation) => operation.origin.as_ref(),
            Self::Imported(operation) => Some(&operation.origin),
        }
    }

    /// The operation id as messages name it.
    fn id_text(&self) -> Result<&str, InternalError> {
        match self {
            Self::Draft(operation) => operation.id.as_ref().map(OperationId::as_str),
            Self::Imported(operation) => Some(operation.id.as_str()),
        }
        .ok_or_else(|| InternalError::new("a relayed operation has no id"))
    }

    /// The surface id as messages name it.
    fn surface_text(&self) -> Result<&str, InternalError> {
        match self {
            Self::Draft(operation) => operation.surface.as_ref().map(SurfaceId::as_str),
            Self::Imported(operation) => Some(operation.surface.as_str()),
        }
        .ok_or_else(|| InternalError::new("a relayed operation has no surface"))
    }

    /// The id of the format the operation writes.
    fn format(&self) -> Option<&FormatId> {
        match self {
            Self::Draft(operation) => operation.format.as_ref(),
            Self::Imported(operation) => Some(&operation.format),
        }
    }
}

/// What a relay route copies: the operation, its surface prefix and the format and style it names.
#[derive(Debug, Clone)]
struct RelaySource<'run> {
    api: String,
    operation: RelayedOperation<'run>,
    surface_prefix: Option<String>,
    format: Option<&'run WireFormat>,
    paging_style: Option<&'run PagingStyle>,
}

/// The catalogue a relayed declaration joins, with its value.
#[derive(Debug, Clone, PartialEq)]
enum RelayDeclarationValue {
    Format(Box<WireFormat>),
    Paging(Box<PagingStyle>),
}

impl RelayDeclarationValue {
    /// The catalogue of the draft the declaration joins.
    const fn catalogue(&self) -> &'static str {
        match self {
            Self::Format(_) => "formats",
            Self::Paging(_) => "pagings",
        }
    }

    const fn origin(&self) -> &Origin {
        match self {
            Self::Format(format) => &format.origin,
            Self::Paging(style) => &style.origin,
        }
    }
}

/// A wire format or a paging style a relay route copies, joined to this api's catalogue once both are written.
#[derive(Debug, Clone)]
pub(crate) struct TreeNodesRelayDeclaration<'node, 'raw> {
    id: String,
    site: TreeNodesSite<'node, 'raw>,
    relays: String,
    value: RelayDeclarationValue,
}

/// The target a relay route names: `relays: <api>.<operationId>`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct RelayTarget {
    api: String,
    id: String,
    text: String,
}

/// Where an element was copied from.
#[derive(Debug, Clone)]
struct RelayStamp {
    api: String,
    from: Origin,
}

/// What an imported operation lacks in its own catalogues.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ImportedMissing {
    format_missing: bool,
    style_missing: bool,
}

/// The members of a relay route copied from the public operation: method, safety, path, params, input, success
/// responses, paging, concurrency, format and `relays`.
///
/// `None` when the target is refused (reported); the copied format and paging style are pushed to `declarations`.
pub(crate) fn tree_nodes_relay_shape<'node, 'raw>(
    site: &TreeNodesSite<'node, 'raw>,
    own_prefix: &str,
    declarations: &mut Vec<TreeNodesRelayDeclaration<'node, 'raw>>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftOperation>, PassError> {
    let target = relay_target(site)?;
    let Some(source) = relay_source(site, &target, scope)? else {
        return Ok(None);
    };

    check_route_name(site, &target, scope)?;

    let operation = source.operation;
    let Some(operation_origin) = operation.origin() else {
        return Err(InternalError::new(format!(
            "the relayed operation {} has no origin",
            target.text
        ))
        .into());
    };
    let stamp = RelayStamp {
        api: source.api.clone(),
        from: tree_nodes_relay_origin(operation_origin, &source.api),
    };

    push_declarations(&source, site, &target, declarations)?;

    let path = match operation.path() {
        Some(_) => Some(relay_path(&source, own_prefix)?),
        None => None,
    };
    let params = copied_params(operation.params(), &stamp);
    let input = operation
        .input()
        .map(|input| copied_input(input, &source.api));
    let responses = copied_responses(operation.responses().unwrap_or_default(), &stamp);
    let paging = operation
        .paging()
        .map(|paging| copied_paging(paging, &source.api));
    let concurrency = operation
        .concurrency()
        .map(|(version, field)| DraftConcurrency {
            version: version.clone(),
            field: field.to_owned(),
            derived_from: None,
        });

    Ok(Some(DraftOperation {
        method: operation.method().cloned(),
        safe: operation.safe(),
        path,
        params: Some(params),
        input,
        responses: Some(responses),
        paging,
        concurrency,
        format: operation.format().cloned(),
        relays: Some(OperationRef {
            kind: TREE_NODES_OPERATION_KIND,
            api: source.api.clone(),
            id: OperationId::new(target.id.clone()),
        }),
        ..DraftOperation::default()
    }))
}

/// Joins each copied format and paging style to this api's catalogue: absent, it is added; present, it is the same.
pub(crate) fn tree_nodes_join_relay_declarations(
    declarations: &[TreeNodesRelayDeclaration<'_, '_>],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let mut joined_by: HashMap<String, &TreeNodesRelayDeclaration<'_, '_>> = HashMap::new();

    for declaration in declarations {
        let key = format!("{}:{}", declaration.value.catalogue(), declaration.id);

        let Some(held) = held_declaration(declaration, scope) else {
            add_declaration(declaration, scope);
            joined_by.insert(key, declaration);
            continue;
        };

        if same_declaration(&held, &declaration.value) {
            continue;
        }

        let first_copy = joined_by.get(&key).copied();

        report_different_declaration(declaration, held.origin(), first_copy, scope)?;
    }

    Ok(())
}
fn held_declaration(
    declaration: &TreeNodesRelayDeclaration<'_, '_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Option<RelayDeclarationValue> {
    match declaration.value {
        RelayDeclarationValue::Format(_) => scope
            .output
            .formats
            .get(declaration.id.as_str())
            .map(|held| RelayDeclarationValue::Format(Box::new(held.clone()))),
        RelayDeclarationValue::Paging(_) => scope
            .output
            .pagings
            .get(declaration.id.as_str())
            .map(|held| RelayDeclarationValue::Paging(Box::new(held.clone()))),
    }
}

fn add_declaration(
    declaration: &TreeNodesRelayDeclaration<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) {
    match &declaration.value {
        RelayDeclarationValue::Format(format) => {
            scope
                .output
                .formats
                .insert(FormatId::new(declaration.id.clone()), (**format).clone());
        }
        RelayDeclarationValue::Paging(style) => {
            scope
                .output
                .pagings
                .insert(PagingId::new(declaration.id.clone()), (**style).clone());
        }
    }
}

// Two declarations are one when they differ by their origin only: a shared file read by both apis.
fn same_declaration(held: &RelayDeclarationValue, copied: &RelayDeclarationValue) -> bool {
    match (held, copied) {
        (RelayDeclarationValue::Format(held), RelayDeclarationValue::Format(copied)) => {
            WireFormat {
                origin: copied.origin.clone(),
                ..(**held).clone()
            } == **copied
        }
        (RelayDeclarationValue::Paging(held), RelayDeclarationValue::Paging(copied)) => {
            PagingStyle {
                origin: copied.origin.clone(),
                ..(**held).clone()
            } == **copied
        }
        (RelayDeclarationValue::Format(_), RelayDeclarationValue::Paging(_))
        | (RelayDeclarationValue::Paging(_), RelayDeclarationValue::Format(_)) => false,
    }
}

fn report_different_declaration(
    declaration: &TreeNodesRelayDeclaration<'_, '_>,
    held_origin: &Origin,
    first_copy: Option<&TreeNodesRelayDeclaration<'_, '_>>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let site = &declaration.site;
    let id = &declaration.id;
    let kind = match declaration.value {
        RelayDeclarationValue::Format(_) => "wire format",
        RelayDeclarationValue::Paging(_) => "paging style",
    };
    let origin = relays_origin(site, scope)?;
    let held = match first_copy {
        None => RelatedLocation {
            origin: tree_nodes_locate(held_origin, &origin),
            message: format!("the {kind} {id} of this api"),
        },
        Some(first) => RelatedLocation {
            origin: relays_origin(&first.site, scope)?,
            message: format!(
                "the {kind} {id} copied for the relay route {}",
                first.site.operation_id
            ),
        },
    };
    let copied = RelatedLocation {
        origin: tree_nodes_locate(declaration.value.origin(), &origin),
        message: format!("the {kind} {id} of {}", declaration.relays),
    };

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::RelayDeclaration,
            origin,
            message: format!(
                "The relay route {} copies the {kind} {id} of {}, which differs from the {kind} {id} this api already holds.",
                site.operation_id, declaration.relays
            ),
            fix: format!(
                "Declare {id} once in a shared file both apis read, or rename one of the two."
            ),
            related: vec![held, copied],
        }));

    Ok(())
}

fn push_declarations<'node, 'raw>(
    source: &RelaySource<'_>,
    site: &TreeNodesSite<'node, 'raw>,
    target: &RelayTarget,
    declarations: &mut Vec<TreeNodesRelayDeclaration<'node, 'raw>>,
) -> Result<(), PassError> {
    let operation = source.operation;
    let style = operation.paging().and_then(|paging| paging.style.as_ref());

    // The relayed api writes every format and style its operations name, so a missing one is a broken draft.
    if (operation.format().is_some() && source.format.is_none())
        || (style.is_some() && source.paging_style.is_none())
    {
        return Err(InternalError::new(format!(
            "the relayed operation {} names a format or paging style its api does not hold",
            target.text
        ))
        .into());
    }

    if let (Some(format_id), Some(format)) = (operation.format(), source.format) {
        declarations.push(TreeNodesRelayDeclaration {
            id: format_id.as_str().to_owned(),
            site: site.clone(),
            relays: target.text.clone(),
            value: RelayDeclarationValue::Format(Box::new(WireFormat {
                origin: tree_nodes_relay_origin(&format.origin, &source.api),
                ..format.clone()
            })),
        });
    }

    if let (Some(style_id), Some(paging_style)) = (style, source.paging_style) {
        declarations.push(TreeNodesRelayDeclaration {
            id: style_id.as_str().to_owned(),
            site: site.clone(),
            relays: target.text.clone(),
            value: RelayDeclarationValue::Paging(Box::new(PagingStyle {
                origin: tree_nodes_relay_origin(&paging_style.origin, &source.api),
                ..paging_style.clone()
            })),
        });
    }

    Ok(())
}

/// An element a relay route copies, which carries the origin it is copied from and the derivation that stamps it.
trait RelayCopied: Clone {
    fn origin(&self) -> Option<&Origin>;

    fn stamp(&mut self, origin: Option<Origin>, derived_from: DerivedFrom);
}

impl RelayCopied for Param {
    fn origin(&self) -> Option<&Origin> {
        self.origin.as_ref()
    }

    fn stamp(&mut self, origin: Option<Origin>, derived_from: DerivedFrom) {
        self.origin = origin;
        self.derived_from = Some(derived_from);
    }
}

impl RelayCopied for ResponseHeader {
    fn origin(&self) -> Option<&Origin> {
        self.origin.as_ref()
    }

    fn stamp(&mut self, origin: Option<Origin>, derived_from: DerivedFrom) {
        self.origin = origin;
        self.derived_from = Some(derived_from);
    }
}

impl RelayCopied for Response {
    fn origin(&self) -> Option<&Origin> {
        self.origin.as_ref()
    }

    fn stamp(&mut self, origin: Option<Origin>, derived_from: DerivedFrom) {
        self.origin = origin;
        self.derived_from = Some(derived_from);
    }
}

// A copied element: its origin in the other api, and `derivedFrom: relay.route` from the public operation.
fn stamped<Element: RelayCopied>(element: &Element, stamp: &RelayStamp) -> Element {
    let mut copied = element.clone();
    let origin = element
        .origin()
        .map(|origin| tree_nodes_relay_origin(origin, &stamp.api));

    copied.stamp(
        origin,
        DerivedFrom {
            derivation: RELAY_DERIVATION,
            from: vec![stamp.from.clone()],
        },
    );

    copied
}

fn is_copied(derived_from: Option<&DerivedFrom>, derivations: &[DerivationId]) -> bool {
    derived_from.is_none_or(|derived| derivations.contains(&derived.derivation))
}

fn copied_params(params: Option<&Params>, stamp: &RelayStamp) -> Params {
    let copied = |list: Option<&Vec<Param>>| -> Vec<Param> {
        list.map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .filter(|param| is_copied(param.derived_from.as_ref(), COPIED_ELEMENT_DERIVATIONS))
            .map(|param| stamped(param, stamp))
            .collect()
    };

    Params {
        path: copied(params.map(|params| &params.path)),
        query: copied(params.map(|params| &params.query)),
        header: copied(params.map(|params| &params.header)),
    }
}

// The body input with its media, schema and fields; never `proofs`, `rawBody` or `bodyLimitBytes`,
// which the relay route derives under its own settings.
fn copied_input(input: DraftOperationInputRef<'_>, api: &str) -> DraftOperationInput {
    DraftOperationInput {
        media: input.media.clone(),
        schema: input.schema.clone(),
        body_limit_bytes: None,
        raw_body: None,
        fields: input.fields.map(<[_]>::to_vec),
        proofs: None,
        origin: tree_nodes_relay_origin(input.origin, api),
    }
}

fn copied_responses(responses: &[Response], stamp: &RelayStamp) -> Vec<Response> {
    responses
        .iter()
        .filter(|response| is_copied(response.derived_from.as_ref(), COPIED_RESPONSE_DERIVATIONS))
        .map(|response| Response {
            headers: response
                .headers
                .iter()
                .filter(|header| is_copied(header.derived_from.as_ref(), COPIED_ELEMENT_DERIVATIONS))
                .map(|header| stamped(header, stamp))
                .collect(),
            ..stamped(response, stamp)
        })
        .collect()
}

// Sort keys carry their key and origin only: their rights are the gateway's, and the paging's relay provenance
// is the operation's `relays`.
fn copied_paging(paging: &Paging, api: &str) -> Paging {
    Paging {
        style: paging.style.clone(),
        max_limit: paging.max_limit,
        default_limit: paging.default_limit,
        over_limit: paging.over_limit.clone(),
        token: paging.token.clone(),
        sort_keys: paging
            .sort_keys
            .iter()
            .map(|sort_key| SortKey {
                key: sort_key.key.clone(),
                right: None,
                params: None,
                subject: None,
                derived_from: None,
                origin: sort_key
                    .origin
                    .as_ref()
                    .map(|origin| tree_nodes_relay_origin(origin, api)),
            })
            .collect(),
        origin: tree_nodes_relay_origin(&paging.origin, api),
    }
}

// A path is under a prefix at a segment boundary: `/v10/x` is not under `/v1`.
fn path_under_prefix(path: &str, prefix: Option<&str>) -> bool {
    prefix.is_some_and(|prefix| {
        path == prefix
            || path
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

// The public path after its surface's prefix, appended to this surface's prefix.
fn relay_path(source: &RelaySource<'_>, own_prefix: &str) -> Result<String, PassError> {
    let path = source.operation.path().unwrap_or_default();
    let under = source
        .surface_prefix
        .as_deref()
        .filter(|prefix| path_under_prefix(path, Some(prefix)));
    let Some(rest) = under.and_then(|prefix| path.strip_prefix(prefix)) else {
        return Err(InternalError::new(format!(
            "the relayed operation {}.{} has the path {path}, which does not start with the prefix of its surface {}",
            source.api,
            source.operation.id_text()?,
            source.operation.surface_text()?
        ))
        .into());
    };

    Ok(format!("{own_prefix}{rest}"))
}

// The authoring schema admits `relays` as `<api>.<operationId>` only.
fn relay_target(site: &TreeNodesSite<'_, '_>) -> Result<RelayTarget, PassError> {
    let target = tree_nodes_text(site.node, "relays")
        .and_then(|text| Some((text, text.split_once('.')?)))
        .filter(|(_, (api, _))| !api.is_empty());
    let Some((text, (api, id))) = target else {
        return Err(InternalError::new(format!(
            "the relay route at {} has no relays <api>.<operationId>",
            site.node.pointer
        ))
        .into());
    };

    Ok(RelayTarget {
        api: api.to_owned(),
        id: id.to_owned(),
        text: text.to_owned(),
    })
}

fn relay_source<'run>(
    site: &TreeNodesSite<'_, '_>,
    target: &RelayTarget,
    scope: &mut TreeNodesScope<'_, '_, 'run>,
) -> Result<Option<RelaySource<'run>>, PassError> {
    if let Some(relayed) = scope.context.relayed(&target.api) {
        return relayed_source(site, target, relayed, scope);
    }

    if let Some(imported) = scope.context.imported_ir(&target.api) {
        return imported_source(site, target, imported, scope);
    }

    report_target(
        site,
        &format!(
            "relays {}, but {} is neither an api of the workspace nor an import",
            target.text, target.api
        ),
        "Name an api of the workspace, or add it to workspace.imports.",
        TreeNodesRule::RelayTarget,
        scope,
    )?;

    Ok(None)
}

fn relayed_source<'run>(
    site: &TreeNodesSite<'_, '_>,
    target: &RelayTarget,
    relayed: &'run DraftIr,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelaySource<'run>>, PassError> {
    let operation = relayed.operations.iter().find(|candidate| {
        candidate.kind.as_ref() == Some(&TREE_NODES_OPERATION_KIND)
            && candidate
                .id
                .as_ref()
                .is_some_and(|id| id.as_str() == target.id)
    });
    let Some(operation) = operation else {
        report_no_operation(site, target, scope)?;

        return Ok(None);
    };
    let surface_prefix = relayed
        .api
        .as_ref()
        .zip(operation.surface.as_ref())
        .and_then(|(api, surface)| api.surfaces.get(surface.as_str()))
        .map(|surface| surface.prefix.clone());

    Ok(Some(RelaySource {
        api: target.api.clone(),
        operation: RelayedOperation::Draft(operation),
        surface_prefix,
        format: own_entry(
            &relayed.formats,
            operation.format.as_ref().map(FormatId::as_str),
        ),
        paging_style: own_entry(
            &relayed.pagings,
            operation
                .paging
                .as_ref()
                .and_then(|paging| paging.style.as_ref())
                .map(PagingId::as_str),
        ),
    }))
}

// An imported IR may hold a union arm, an open-enum value or a member this compiler does not know: the operation
// is copied only when none sits in it, its format or its paging style; each one found is named. All three are
// narrowed by the closed-IR guard. An import is external input, so an operation whose path leaves its surface's
// prefix or that names a format or paging style the import does not hold is refused, located, as well.
fn imported_source<'run>(
    site: &TreeNodesSite<'_, '_>,
    target: &RelayTarget,
    imported: &'run ImportedIr,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelaySource<'run>>, PassError> {
    let contract = imported.contract();
    let document = imported.document();
    let found = imported_operation_index(contract, &target.id)
        .and_then(|index| contract.operations.get(index).map(|found| (index, found)));
    let Some((index, found)) = found else {
        report_no_operation(site, target, scope)?;

        return Ok(None);
    };
    let operation = check_closed(found, document, &format!("/operations/{index}"))?;
    let format = imported_declaration(
        &contract.formats,
        document,
        "/formats",
        Some(found.format.as_str()),
    )?;
    let style = imported_declaration(
        &contract.pagings,
        document,
        "/pagings",
        found.paging.as_ref().and_then(|paging| paging.style.as_ref()).map(PagingId::as_str),
    )?;
    let unknowns: Vec<String> = [
        named_unknowns(Some(&operation)),
        named_unknowns(format.as_ref()),
        named_unknowns(style.as_ref()),
    ]
    .concat();
    let IrClosedCheck::Closed(closed) = operation else {
        return report_unknown(site, target, &unknowns, scope).map(|()| None);
    };

    if !unknowns.is_empty() {
        return report_unknown(site, target, &unknowns, scope).map(|()| None);
    }

    let surface_prefix = contract
        .api
        .surfaces
        .get(closed.surface.as_str())
        .map(|surface| surface.prefix.as_str());
    let style_named = found.paging.as_ref().is_some_and(|paging| paging.style.is_some());
    let inconsistency = import_inconsistency(
        closed,
        surface_prefix,
        ImportedMissing {
            format_missing: format.is_none(),
            style_missing: style_named && style.is_none(),
        },
    );

    if let Some(inconsistency) = inconsistency {
        report_target(
            site,
            &format!(
                "relays {}, but the import {} is inconsistent: {inconsistency}",
                target.text, target.api
            ),
            &format!(
                "Relay an operation of an IR that {} compiled, or fix the import.",
                target.api
            ),
            TreeNodesRule::RelayTarget,
            scope,
        )?;

        return Ok(None);
    }

    Ok(Some(RelaySource {
        api: target.api.clone(),
        operation: RelayedOperation::Imported(closed),
        surface_prefix: surface_prefix.map(str::to_owned),
        format: format.and_then(closed_declaration),
        paging_style: style.and_then(closed_declaration),
    }))
}

fn report_unknown(
    site: &TreeNodesSite<'_, '_>,
    target: &RelayTarget,
    unknowns: &[String],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    report_target(
        site,
        &format!(
            "relays {}, which holds what this compiler does not know ({}), so it cannot be copied",
            target.text,
            unknowns.join(", ")
        ),
        &format!(
            "Compile with a seampact version that reads the IR of {}, or relay another operation.",
            target.api
        ),
        TreeNodesRule::RelayUnknown,
        scope,
    )
}

fn check_closed<'declaration, Declaration: IrClosedDeclaration>(
    declaration: &'declaration Declaration,
    document: &JsonValue,
    pointer: &str,
) -> Result<IrClosedCheck<'declaration, Declaration>, InternalError> {
    check_ir_closed_declaration(declaration, document, pointer)
        .map_err(|error| InternalError::new(error.to_string()))
}

fn closed_declaration<Declaration>(
    check: IrClosedCheck<'_, Declaration>,
) -> Option<&Declaration> {
    match check {
        IrClosedCheck::Closed(declaration) => Some(declaration),
        IrClosedCheck::Unknowns(_) => None,
    }
}

/// What an imported operation holds that contradicts its own IR, else `None`: a path outside its surface's
/// prefix, a format or a paging style its catalogue lacks.
fn import_inconsistency(
    operation: &Operation,
    surface_prefix: Option<&str>,
    missing: ImportedMissing,
) -> Option<String> {
    let id = operation.id.as_str();
    let surface = operation.surface.as_str();
    let path = operation.path.as_str();

    if surface_prefix.is_none() {
        return Some(format!(
            "the operation {id} is on the surface {surface}, which the import does not declare"
        ));
    }

    if !path_under_prefix(path, surface_prefix) {
        return Some(format!(
            "the operation {id} has the path {}, which does not start with the prefix of its surface {surface}",
            access_rights_quoted(path)
        ));
    }

    if missing.format_missing {
        return Some(format!(
            "the operation {id} names a wire format the import does not declare"
        ));
    }

    if missing.style_missing {
        return Some(format!(
            "the operation {id} names a paging style the import does not declare"
        ));
    }

    None
}

// The operation of an id, an `httpOperation` first: one of another kind is refused by the closed-IR guard.
fn imported_operation_index(imported: &ContractIr, id: &str) -> Option<usize> {
    imported
        .operations
        .iter()
        .position(|candidate| {
            candidate.kind == TREE_NODES_OPERATION_KIND && candidate.id.as_str() == id
        })
        .or_else(|| {
            imported
                .operations
                .iter()
                .position(|candidate| candidate.id.as_str() == id)
        })
}

// An imported catalogue entry the operation names, checked by the closed-IR guard; `None` when it names none or
// the catalogue lacks it.
fn imported_declaration<'run, Key, Declaration>(
    catalogue: &'run IrMap<Key, Declaration>,
    document: &JsonValue,
    root: &str,
    id: Option<&str>,
) -> Result<Option<IrClosedCheck<'run, Declaration>>, InternalError>
where
    Key: Borrow<str> + AsRef<str> + Hash + Eq,
    Declaration: IrClosedDeclaration,
{
    let Some(id) = id else {
        return Ok(None);
    };
    let Some(entry) = own_entry(catalogue, Some(id)) else {
        return Ok(None);
    };

    check_closed(entry, document, &pointer_below(root, &[id])).map(Some)
}

fn named_unknowns<Declaration>(check: Option<&IrClosedCheck<'_, Declaration>>) -> Vec<String> {
    match check {
        Some(IrClosedCheck::Unknowns(unknowns)) => unknowns
            .iter()
            .map(|unknown| format!("{} at {}", unknown.value, unknown.pointer))
            .collect(),
        Some(IrClosedCheck::Closed(_)) | None => Vec::new(),
    }
}

fn own_entry<'catalogue, Key: Borrow<str> + AsRef<str> + Hash + Eq, Value>(
    catalogue: &'catalogue IrMap<Key, Value>,
    id: Option<&str>,
) -> Option<&'catalogue Value> {
    id.and_then(|id| catalogue.get(id))
}

// The route name is the public operation id unless the route sets `operationId` (grammar section 7).
fn check_route_name(
    site: &TreeNodesSite<'_, '_>,
    target: &RelayTarget,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let node = site.node;

    if tree_nodes_text(node, "operationId").is_some() || node.name == target.id {
        return Ok(());
    }

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: TreeNodesRule::RelayName,
            origin: tree_nodes_node_origin(&node.origin)?,
            message: format!(
                "The relay route {} relays {}, so its name must be the public operation id {}.",
                node.name, target.text, target.id
            ),
            fix: format!(
                "Rename the route {}, or set operationId on it.",
                target.id
            ),
            related: Vec::new(),
        }));

    Ok(())
}

fn report_no_operation(
    site: &TreeNodesSite<'_, '_>,
    target: &RelayTarget,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    report_target(
        site,
        &format!(
            "relays {}, but the api {} has no operation {}",
            target.text, target.api, target.id
        ),
        &format!("Name an operation id of {}.", target.api),
        TreeNodesRule::RelayTarget,
        scope,
    )
}

fn report_target(
    site: &TreeNodesSite<'_, '_>,
    fault: &str,
    fix: &str,
    rule: TreeNodesRule,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let origin = relays_origin(site, scope)?;

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule,
            origin,
            message: format!("The relay route {} {fault}.", site.operation_id),
            fix: fix.to_owned(),
            related: Vec::new(),
        }));

    Ok(())
}

fn relays_origin(
    site: &TreeNodesSite<'_, '_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<DiagnosticOrigin, InternalError> {
    let origin = scope
        .context
        .origin(&format!("{}/relays", site.node.pointer))
        .unwrap_or_else(|| site.node.origin.clone());

    tree_nodes_node_origin(&origin)
}

#[cfg(test)]
mod tests {
    use super::path_under_prefix;

    #[test]
    fn a_path_is_under_a_prefix_at_a_segment_boundary_only() {
        for (path, prefix, expected) in [
            ("/v1", Some("/v1"), true),
            ("/v1/tasks", Some("/v1"), true),
            ("/v10/tasks", Some("/v1"), false),
            ("/v1", Some("/v1/"), false),
            ("/tasks", Some(""), true),
            ("", Some(""), true),
            ("/v1", None, false),
        ] {
            assert_eq!(
                path_under_prefix(path, prefix),
                expected,
                "path {path:?} prefix {prefix:?}"
            );
        }
    }
}
