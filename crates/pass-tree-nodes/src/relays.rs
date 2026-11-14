//! Relay routes: an operation that copies another api's operation, with the formats and paging styles it needs.

use seampact_ir::{
    ContractIr, DerivedFrom, IrMap, Operation, Origin, Paging, PagingStyle, Params, Response,
    WireFormat,
};
use seampact_pipeline::{DraftIr, DraftOperation, DraftOperationInput, PassError};

use crate::diagnostics::TreeNodesRule;
use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

/// The derivation that stamps what a relay route copies.
const RELAY_DERIVATION: &str = "relay.route";
/// The derivations whose responses a relay route copies.
const COPIED_RESPONSE_DERIVATIONS: &[&str] = &["response.format", "batch.read", RELAY_DERIVATION];
/// The derivations whose elements a relay route copies.
const COPIED_ELEMENT_DERIVATIONS: &[&str] = &[RELAY_DERIVATION];

/// An operation of a draft another api produced, or of an imported IR read in the same shape.
type RelayedOperation = DraftOperation;

/// What a relay route copies: the operation, its surface prefix and the format and style it names.
#[derive(Debug, Clone)]
struct RelaySource {
    api: String,
    operation: RelayedOperation,
    surface_prefix: Option<String>,
    format: Option<WireFormat>,
    paging_style: Option<PagingStyle>,
}

/// The catalogue a relayed declaration joins, with its value.
#[derive(Debug, Clone, PartialEq)]
enum RelayDeclarationValue {
    Format(Box<WireFormat>),
    Paging(Box<PagingStyle>),
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

pub(crate) fn tree_nodes_relay_shape(
    _site: &TreeNodesSite<'_, '_>,
    _own_prefix: &str,
    _declarations: &mut Vec<TreeNodesRelayDeclaration<'_, '_>>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftOperation>, PassError> {
    Err(not_ported_yet("treeNodesRelayShape"))
}

pub(crate) fn tree_nodes_join_relay_declarations(
    _declarations: &[TreeNodesRelayDeclaration<'_, '_>],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesJoinRelayDeclarations"))
}

fn held_declaration(
    _declaration: &TreeNodesRelayDeclaration<'_, '_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelayDeclarationValue>, PassError> {
    Err(not_ported_yet("heldDeclaration"))
}

fn add_declaration(
    _declaration: &TreeNodesRelayDeclaration<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("addDeclaration"))
}

fn same_declaration(_held: &Origin, _copied: &RelayDeclarationValue) -> Result<bool, PassError> {
    Err(not_ported_yet("sameDeclaration"))
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
    _source: &RelaySource,
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _declarations: &mut Vec<TreeNodesRelayDeclaration<'_, '_>>,
) -> Result<(), PassError> {
    Err(not_ported_yet("pushDeclarations"))
}

fn stamped<Element: Clone>(_element: &Element, _stamp: &RelayStamp) -> Result<Element, PassError> {
    Err(not_ported_yet("stamped"))
}

fn is_copied(
    _derived_from: Option<&DerivedFrom>,
    _derivations: &[&str],
) -> Result<bool, PassError> {
    Err(not_ported_yet("isCopied"))
}

fn copied_params(_params: Option<&Params>, _stamp: &RelayStamp) -> Result<Params, PassError> {
    Err(not_ported_yet("copiedParams"))
}

fn copied_input(
    _input: &DraftOperationInput,
    _api: &str,
) -> Result<DraftOperationInput, PassError> {
    Err(not_ported_yet("copiedInput"))
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

fn path_under_prefix(_path: &str, _prefix: Option<&str>) -> Result<bool, PassError> {
    Err(not_ported_yet("pathUnderPrefix"))
}

fn relay_path(_source: &RelaySource, _own_prefix: &str) -> Result<String, PassError> {
    Err(not_ported_yet("relayPath"))
}

fn relay_target(_site: &TreeNodesSite<'_, '_>) -> Result<RelayTarget, PassError> {
    Err(not_ported_yet("relayTarget"))
}

fn relay_source(
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelaySource>, PassError> {
    Err(not_ported_yet("relaySource"))
}

fn relayed_source(
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _relayed: &DraftIr,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelaySource>, PassError> {
    Err(not_ported_yet("relayedSource"))
}

fn imported_source(
    _site: &TreeNodesSite<'_, '_>,
    _target: &RelayTarget,
    _imported: &ContractIr,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<RelaySource>, PassError> {
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

fn own_entry<'catalogue, Key, Value>(
    _catalogue: &'catalogue IrMap<Key, Value>,
    _id: Option<&str>,
) -> Result<Option<&'catalogue Value>, PassError> {
    Err(not_ported_yet("ownEntry"))
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
    _site: &TreeNodesSite<'_, '_>,
    _fault: &str,
    _fix: &str,
    _rule: TreeNodesRule,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportTarget"))
}

fn relays_origin(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Origin, PassError> {
    Err(not_ported_yet("relaysOrigin"))
}
