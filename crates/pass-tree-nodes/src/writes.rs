//! Who owns an operation and the concurrency token it carries, inherited from its resource.

use seampact_diagnostics::InternalError;
use seampact_ir::{OpShorthand, Origin, Owner, OwnerKind, Param, Params, TypeUse};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{tree_nodes_op_owner, tree_nodes_text};
use seampact_pipeline::{DraftConcurrency, PassError, TreeNode, TreeNodeKind, TreeNodes};

use crate::fields::TreeNodesSite;
use crate::not_ported::not_ported_yet;
use crate::pass::TreeNodesScope;

const OWNER_CALLER: OwnerKind = OwnerKind::Caller;
/// The value of `concurrency` that inherits the resource's.
const INHERIT: &str = "inherit";
/// The ops that inherit the resource's concurrency.
const VERSIONED_OPS: &[OpShorthand] = &[OpShorthand::Update, OpShorthand::Delete];

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

// A caller-owned record has no version. That `field` names an item property is tree.schemas' check, made
// where it adds the version.
fn check_declaration(
    site: &TreeNodesSite<'_, '_>,
    resource: Option<&TreeNode<'_>>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(resource) = resource else {
        return Ok(());
    };

    if !resource.settings.contains_key("concurrency") {
        return Ok(());
    }

    check_owner_alone(site, resource, scope)
}
/// The collection or single an operation writes: the owner of its op, else its nearest one.
fn resource_node_of<'nodes, 'raw>(
    node: &TreeNode<'raw>,
    nodes: &'nodes TreeNodes<'raw>,
) -> Result<Option<&'nodes TreeNode<'raw>>, InternalError> {
    if node.kind == TreeNodeKind::Op {
        return tree_nodes_op_owner(nodes, node);
    }

    let mut at = node.parent;

    while let Some(at_id) = at {
        let current = nodes.get(at_id)?;

        if matches!(
            current.kind,
            TreeNodeKind::Collection | TreeNodeKind::Single
        ) {
            return Ok(Some(current));
        }

        at = current.parent;
    }

    Ok(None)
}
/// `owner: caller`, written on the collection or single the operation belongs to.
pub(crate) fn tree_nodes_owner(
    site: &TreeNodesSite<'_, '_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<Option<Owner>, PassError> {
    let Some(resource) = resource_node_of(site.node, site.nodes)? else {
        return Ok(None);
    };

    if tree_nodes_text(resource, "owner") != Some(OWNER_CALLER.as_str()) {
        return Ok(None);
    }

    let pointer = format!("{}/owner", resource.pointer);
    let Some(origin) = scope.context.origin(&pointer) else {
        return Err(InternalError::new(format!("the raw tree has no origin for {pointer}")).into());
    };

    Ok(Some(Owner {
        kind: OWNER_CALLER,
        origin,
    }))
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

// A concurrency source is `body.<name>`, `query.<name>` or `header.<name>`.
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
