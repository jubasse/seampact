//! The lifecycle members of an operation: budget, deprecation, upstream services, maturity, internal, tags and extensions.

use indexmap::IndexMap;
use seampact_diagnostics::DiagnosticOrigin;
use seampact_ir::{ApiKind, Deprecation, Extensions, MaturitySource, OperationMaturity, Origin};
use seampact_json::JsonValue;
use seampact_pipeline::{DraftOperation, InheritedEntry, PassError, TreeNode};

use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

const SERVICE_API: ApiKind = ApiKind::Service;
const STATED: MaturitySource = MaturitySource::Stated;
/// The convention a batch's budget falls back to.
const BATCH_BUDGET: &str = "batch.budget";
/// The key shape of an extension: `x-<prefix>-<name>`.
const EXTENSION_KEY: &str = r"^x-([a-z][a-z0-9]*)-(.+)$";
const DEPRECATION_FIX: &str = "Write deprecated: { since: '<date>', sunset: '<date>' }.";

/// Which member of `deprecated` a refusal points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeprecationMember {
    Since,
    Sunset,
}

/// The rule a deprecation refusal reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeprecationRule {
    DeprecatedSince,
    DeprecatedSunset,
}

/// A refused deprecation.
#[derive(Debug, Clone)]
struct DeprecationRefusal {
    rule: DeprecationRule,
    /// The member the refusal points at; absent, the refusal points at `deprecated`.
    member: Option<DeprecationMember>,
    message: String,
    fix: String,
}

/// The extensions of a node by prefix and then key.
type ExtensionValues = IndexMap<String, IndexMap<String, JsonValue>>;

pub(crate) fn tree_nodes_own_extensions(
    _written: Option<&JsonValue>,
) -> Result<Extensions, PassError> {
    Err(not_ported_yet("treeNodesOwnExtensions"))
}

fn extensions_of(_values: &ExtensionValues) -> Result<Extensions, PassError> {
    Err(not_ported_yet("extensionsOf"))
}

fn add_extensions(
    _written: Option<&JsonValue>,
    _values: &mut ExtensionValues,
) -> Result<(), PassError> {
    Err(not_ported_yet("addExtensions"))
}

pub(crate) fn tree_nodes_extensions(_node: &TreeNode<'_>) -> Result<Extensions, PassError> {
    Err(not_ported_yet("treeNodesExtensions"))
}

pub(crate) fn tree_nodes_tags(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("treeNodesTags"))
}

pub(crate) fn tree_nodes_upstream(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<String>, PassError> {
    Err(not_ported_yet("treeNodesUpstream"))
}

pub(crate) fn tree_nodes_internal(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("treeNodesInternal"))
}

pub(crate) fn tree_nodes_stated_maturity(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<OperationMaturity>, PassError> {
    Err(not_ported_yet("treeNodesStatedMaturity"))
}

pub(crate) fn tree_nodes_budget_ms(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<i64>, PassError> {
    Err(not_ported_yet("treeNodesBudgetMs"))
}

pub(crate) fn tree_nodes_deprecated(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Deprecation>, PassError> {
    Err(not_ported_yet("treeNodesDeprecated"))
}

pub(crate) fn tree_nodes_check_successor(
    _operation: &DraftOperation,
    _operations: &[DraftOperation],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("treeNodesCheckSuccessor"))
}

fn successor_rel_of(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<String, PassError> {
    Err(not_ported_yet("successorRelOf"))
}

fn deprecation_dates_hold(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _since: Option<&JsonValue>,
    _sunset: Option<&JsonValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("deprecationDatesHold"))
}

fn since_is_date(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _since: Option<&JsonValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("sinceIsDate"))
}

fn sunset_is_date(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _sunset: Option<&JsonValue>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("sunsetIsDate"))
}

fn report_successor_params(
    _origin: &DiagnosticOrigin,
    _operation: &DraftOperation,
    _successor: &DraftOperation,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportSuccessorParams"))
}

fn report_deprecation(
    _site: &TreeNodesSite<'_, '_>,
    _origin: &Origin,
    _refusal: &DeprecationRefusal,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportDeprecation"))
}

fn report_unknown_service(
    _site: &TreeNodesSite<'_, '_>,
    _service: &str,
    _entry: &InheritedEntry<'_>,
    _index: usize,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportUnknownService"))
}
