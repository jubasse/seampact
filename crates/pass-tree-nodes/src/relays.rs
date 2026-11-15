//! Relay routes: an operation that copies another api's operation, with the formats and paging styles it needs.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;

use seampact_diagnostics::{DiagnosticOrigin, InternalError};
use seampact_ir::{
    ContractIr, DerivationId, DerivedFrom, FormatId, HttpMethod, IrMap, Operation, OperationId,
    OperationRef, Origin, Paging, PagingStyle, Param, Params, Response, ResponseHeader, SurfaceId,
    ValueSource, WireFormat,
};
use seampact_pass_tree_shared::{
    TREE_NODES_OPERATION_KIND, tree_nodes_relay_origin, tree_nodes_text,
};
use seampact_pipeline::{
    DraftConcurrency, DraftIr, DraftOperation, DraftOperationInput, DraftOperationInputRef,
    PassError,
};

use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
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

/// A member of an imported IR this compiler does not know, with where it is.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ClosedUnknown {
    pointer: String,
    value: String,
}

/// An imported declaration read as this compiler's own, or the members it does not know.
#[derive(Debug, Clone, PartialEq)]
enum ClosedCheck<Declaration> {
    Closed(Declaration),
    Unknown(Vec<ClosedUnknown>),
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
pub(crate) fn tree_nodes_relay_shape(
    site: &TreeNodesSite<'_, '_>,
    own_prefix: &str,
    declarations: &mut Vec<TreeNodesRelayDeclaration<'_, '_>>,
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
    let params = copied_params(operation.params(), &stamp)?;
    let input = operation
        .input()
        .map(|input| copied_input(input, &source.api));
    let responses = copied_responses(operation.responses().unwrap_or_default(), &stamp)?;
    let paging = operation
        .paging()
        .map(|paging| copied_paging(paging, &source.api))
        .transpose()?;
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
            add_declaration(declaration, scope)?;
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
    _declaration: &TreeNodesRelayDeclaration<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("addDeclaration"))
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
    _declaration: &TreeNodesRelayDeclaration<'_, '_>,
    _held_origin: &Origin,
    _first_copy: Option<&TreeNodesRelayDeclaration<'_, '_>>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportDifferentDeclaration"))
}

fn push_declarations(
    _source: &RelaySource<'_>,
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _declarations: &mut Vec<TreeNodesRelayDeclaration<'_, '_>>,
) -> Result<(), PassError> {
    Err(not_ported_yet("pushDeclarations"))
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

fn copied_params(_params: Option<&Params>, _stamp: &RelayStamp) -> Result<Params, PassError> {
    Err(not_ported_yet("copiedParams"))
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

fn copied_responses(
    _responses: &[Response],
    _stamp: &RelayStamp,
) -> Result<Vec<Response>, PassError> {
    Err(not_ported_yet("copiedResponses"))
}

fn copied_paging(_paging: &Paging, _api: &str) -> Result<Paging, PassError> {
    Err(not_ported_yet("copiedPaging"))
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

    if let Some(imported) = scope.context.imported(&target.api) {
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
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _relayed: &'run DraftIr,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelaySource<'run>>, PassError> {
    Err(not_ported_yet("relayedSource"))
}

fn imported_source<'run>(
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _imported: &'run ContractIr,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelaySource<'run>>, PassError> {
    Err(not_ported_yet("importedSource"))
}

fn import_inconsistency(
    _operation: &Operation,
    _surface_prefix: Option<&str>,
    _missing: ImportedMissing,
) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("importInconsistency"))
}

fn imported_operation_index(_imported: &ContractIr, _id: &str) -> Result<usize, PassError> {
    Err(not_ported_yet("importedOperationIndex"))
}

fn imported_declaration<Key, Declaration: Clone>(
    _catalogue: &IrMap<Key, Declaration>,
    _root: &str,
    _id: Option<&str>,
) -> Result<Option<ClosedCheck<Declaration>>, PassError> {
    Err(not_ported_yet("importedDeclaration"))
}

fn named_unknowns(_unknowns: Option<&[ClosedUnknown]>) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("namedUnknowns"))
}

fn own_entry<'catalogue, Key: Borrow<str> + AsRef<str> + Hash + Eq, Value>(
    catalogue: &'catalogue IrMap<Key, Value>,
    id: Option<&str>,
) -> Option<&'catalogue Value> {
    id.and_then(|id| catalogue.get(id))
}

fn check_route_name(
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkRouteName"))
}

fn report_no_operation(
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportNoOperation"))
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
