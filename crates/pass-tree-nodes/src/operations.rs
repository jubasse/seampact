//! The operations of the api tree: one per operation node, with its name, route, shape and lifecycle, and the clash checks.

use seampact_ir::{HttpMethod, OpShorthand, OperationResource, Params, TypeUse};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::TreeNodesOperationName;
use seampact_pipeline::{DraftOperation, PassError, TreeNode};

use crate::api::TreeNodesSurfacePrefixes;
use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;
use crate::relays::TreeNodesRelayDeclaration;

const HTTP_METHODS: &[HttpMethod] = &[
    HttpMethod::Get,
    HttpMethod::Post,
    HttpMethod::Put,
    HttpMethod::Patch,
    HttpMethod::Delete,
];
/// The method an operation is safe with.
const SAFE_METHOD: HttpMethod = HttpMethod::Get;
/// The ops that need an input.
const OPS_NEEDING_INPUT: &[OpShorthand] = &[OpShorthand::Create, OpShorthand::Update];

/// An operation node with its name and route, as written.
#[derive(Debug, Clone)]
struct Written<'node, 'raw> {
    node: &'node TreeNode<'raw>,
    name: TreeNodesOperationName,
    route: Option<Route>,
}

/// The method and path of an operation.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Route {
    /// The method and the path, each placeholder compared by position only.
    key: String,
    text: String,
}

/// The rules a clash of two operations reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClashRule {
    OperationIdUnique,
    OperationNameUnique,
}

fn is_http_method(_value: &JsonValue) -> Result<bool, PassError> {
    Err(not_ported_yet("isHttpMethod"))
}

pub(crate) fn tree_nodes_operations<'node, 'raw>(
    _prefixes: &TreeNodesSurfacePrefixes,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<TreeNodesRelayDeclaration<'node, 'raw>>, PassError> {
    Err(not_ported_yet("treeNodesOperations"))
}

fn check_successors(_scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    Err(not_ported_yet("checkSuccessors"))
}

fn member_id_failed(
    _node: &TreeNode<'_>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<bool, PassError> {
    Err(not_ported_yet("memberIdFailed"))
}

fn route_of(_operation: &DraftOperation) -> Result<Option<Route>, PassError> {
    Err(not_ported_yet("routeOf"))
}

fn report_route_clashes(
    _written: &[Written<'_, '_>],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportRouteClashes"))
}

fn operation_of(
    _site: &TreeNodesSite<'_, '_>,
    _name: &TreeNodesOperationName,
    _prefixes: &TreeNodesSurfacePrefixes,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    Err(not_ported_yet("operationOf"))
}

fn relay_operation_of(
    _site: &TreeNodesSite<'_, '_>,
    _name: &TreeNodesOperationName,
    _prefixes: &TreeNodesSurfacePrefixes,
    _relay_declarations: &mut Vec<TreeNodesRelayDeclaration>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    Err(not_ported_yet("relayOperationOf"))
}

fn shape_of(
    _site: &TreeNodesSite<'_, '_>,
    _input: Option<&TypeUse>,
    _params: &Params,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    Err(not_ported_yet("shapeOf"))
}

fn lifecycle_of(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    Err(not_ported_yet("lifecycleOf"))
}

fn report_no_input(
    _site: &TreeNodesSite<'_, '_>,
    _op: &OpShorthand,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportNoInput"))
}

fn report_get_input(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportGetInput"))
}

fn surface_of(_node: &TreeNode<'_>) -> Result<String, PassError> {
    Err(not_ported_yet("surfaceOf"))
}

fn method_of(
    _node: &TreeNode<'_>,
    _op: Option<&OpShorthand>,
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<HttpMethod, PassError> {
    Err(not_ported_yet("methodOf"))
}

fn resource_of(
    _node: &TreeNode<'_>,
    _schemas: Option<&JsonValue>,
) -> Result<Option<OperationResource>, PassError> {
    Err(not_ported_yet("resourceOf"))
}

fn warn_bare_id_singular(
    _node: &TreeNode<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("warnBareIdSingular"))
}

fn report_no_singular(
    _node: &TreeNode<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportNoSingular"))
}

fn report_clashes(
    _written: &[Written<'_, '_>],
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportClashes"))
}

fn report_clash(
    _entry: &Written<'_, '_>,
    _first: &Written<'_, '_>,
    _rule: ClashRule,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportClash"))
}
