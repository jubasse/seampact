//! Who owns an operation and the concurrency token it carries, inherited from its resource.

use seampact_ir::{OpShorthand, Origin, Owner, OwnerKind, Param, Params, TypeUse};
use seampact_json::JsonValue;
use seampact_pipeline::{DraftConcurrency, PassError, TreeNode};

use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

const OWNER_CALLER: OwnerKind = OwnerKind::Caller;
/// The value of `concurrency` that inherits the resource's.
const INHERIT: &str = "inherit";
/// The ops that inherit the resource's concurrency.
const VERSIONED_OPS: &[OpShorthand] = &[OpShorthand::Update, OpShorthand::Delete];
/// A concurrency source: `body.<name>`, `query.<name>` or `header.<name>`.
const VERSION_SOURCE: &str = r"^(body|query|header)\.(.+)$";

/// Where the concurrency version is carried.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VersionPlace {
    Body,
    Query,
    Header,
}

/// The place and name a concurrency version is read from.
#[derive(Debug, Clone, PartialEq, Eq)]
struct VersionSource {
    place: VersionPlace,
    name: String,
}

fn check_declaration(
    _site: &TreeNodesSite<'_, '_>,
    _resource: Option<&TreeNode<'_>>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkDeclaration"))
}

fn resource_node_of<'node, 'raw>(
    _node: &'node TreeNode<'raw>,
) -> Result<Option<&'node TreeNode<'raw>>, PassError> {
    Err(not_ported_yet("resourceNodeOf"))
}

pub(crate) fn tree_nodes_owner(
    _site: &TreeNodesSite<'_, '_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Owner>, PassError> {
    Err(not_ported_yet("treeNodesOwner"))
}

pub(crate) fn tree_nodes_concurrency(
    _site: &TreeNodesSite<'_, '_>,
    _input: Option<&TypeUse>,
    _params: &Params,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Option<DraftConcurrency>, PassError> {
    Err(not_ported_yet("treeNodesConcurrency"))
}

fn origin_of(
    _site: &TreeNodesSite<'_, '_>,
    _param: Option<&Param>,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Origin>, PassError> {
    Err(not_ported_yet("originOf"))
}

fn check_owner_alone(
    _site: &TreeNodesSite<'_, '_>,
    _resource: &TreeNode<'_>,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkOwnerAlone"))
}

fn parse_source(_written: &JsonValue) -> Result<Option<VersionSource>, PassError> {
    Err(not_ported_yet("parseSource"))
}

fn on_member_scope(_node: &TreeNode<'_>, _resource: &TreeNode<'_>) -> Result<bool, PassError> {
    Err(not_ported_yet("onMemberScope"))
}

fn check_not_restated(
    _site: &TreeNodesSite<'_, '_>,
    _source: &VersionSource,
    _input: Option<&TypeUse>,
    _params: &Params,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("checkNotRestated"))
}

fn restating_origin(
    _site: &TreeNodesSite<'_, '_>,
    _source: &VersionSource,
    _input: Option<&TypeUse>,
    _params: &Params,
    _scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Origin>, PassError> {
    Err(not_ported_yet("restatingOrigin"))
}

fn report_nothing_to_inherit(
    _site: &TreeNodesSite<'_, '_>,
    _why: &str,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("reportNothingToInherit"))
}
