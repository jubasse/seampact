//! The operations of the api tree: one per operation node, with its name, route, shape and lifecycle, and the clash checks.

use std::collections::HashMap;
use std::mem;

use seampact_diagnostics::{InternalError, RelatedLocation};
use seampact_ir::{HttpMethod, OpShorthand, OperationResource, Params, TypeUse};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{
    TreeNodesOperationName, tree_nodes_id_param, tree_nodes_idless_collection,
    tree_nodes_is_operation, tree_nodes_operation_name,
};
use seampact_pipeline::{DraftOperation, PassError, TreeNode, TreeNodeId, TreeNodeKind, TreeNodes};

use crate::api::TreeNodesSurfacePrefixes;
use crate::collections::tree_nodes_report_idless_collection;
use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
};
use crate::fields::TreeNodesSite;
use crate::lifecycle::tree_nodes_check_successor;
use crate::not_ported::not_ported_yet;
use crate::params::blank_placeholders;
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

impl ClashRule {
    const fn rule(self) -> TreeNodesRule {
        match self {
            Self::OperationIdUnique => TreeNodesRule::OperationIdUnique,
            Self::OperationNameUnique => TreeNodesRule::OperationNameUnique,
        }
    }
}

fn is_http_method(value: &JsonValue) -> bool {
    let JsonValue::String(text) = value else {
        return false;
    };

    HTTP_METHODS.iter().any(|method| method.as_str() == text)
}
/// Writes every operation of the api to the output, in tree order, and reports the id and name clashes. Returns the
/// wire formats and paging styles the relay routes copy, which join `formats` and `pagings` once those are written.
pub(crate) fn tree_nodes_operations<'node, 'raw>(
    nodes: &'node TreeNodes<'raw>,
    prefixes: &TreeNodesSurfacePrefixes,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<Vec<TreeNodesRelayDeclaration<'node, 'raw>>, PassError> {
    let raw = scope.context.raw;
    let conventions = *scope.context.conventions;
    let mut written: Vec<Written<'node, 'raw>> = Vec::new();
    let mut relay_declarations = Vec::new();

    for (node_id, node) in nodes.iter() {
        if !tree_nodes_is_operation(node) {
            continue;
        }

        if let Some(collection) = tree_nodes_idless_collection(nodes, node)? {
            tree_nodes_report_idless_collection(node, collection, scope)?;
            continue;
        }

        let Some(name) =
            tree_nodes_operation_name(nodes, node, conventions, raw.merged.get("schemas"))?
        else {
            report_no_singular(node, scope)?;
            continue;
        };

        warn_bare_id_singular(node, scope)?;

        let site = TreeNodesSite {
            node_id,
            node,
            operation_id: name.id.clone(),
        };
        let operation = if node.kind == TreeNodeKind::Relay {
            relay_operation_of(&site, &name, prefixes, &mut relay_declarations, scope)?
        } else {
            operation_of(&site, &name, prefixes, scope)?
        };
        let route = if member_id_failed(node_id, nodes, scope)? {
            None
        } else {
            route_of(&operation)
        };

        scope.output.operations.push(operation);
        written.push(Written { node, name, route });
    }

    report_clashes(&written, scope)?;
    report_route_clashes(&written, scope)?;
    check_successors(scope)?;

    Ok(relay_declarations)
}
// A successor names an operation of this api whose path params it can fill, known once every operation is written.
fn check_successors(scope: &mut TreeNodesScope<'_, '_, '_>) -> Result<(), PassError> {
    let operations = mem::take(&mut scope.output.operations);

    for operation in &operations {
        tree_nodes_check_successor(operation, &operations, scope)?;
    }

    scope.output.operations = operations;

    Ok(())
}
// A member route under a collection whose `id` gives no parameter has no placeholder in its path; the `id` is
// already refused, so comparing that path would only repeat the error as a route clash.
fn member_id_failed(
    node_id: TreeNodeId,
    nodes: &TreeNodes<'_>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<bool, InternalError> {
    let mut at = nodes.get(node_id)?.parent;

    while let Some(at_id) = at {
        let current = nodes.get(at_id)?;
        let collection_id = (current.kind == TreeNodeKind::Scope && current.name == "member")
            .then_some(current.parent)
            .flatten();

        if let Some(collection_id) = collection_id {
            let collection = nodes.get(collection_id)?;

            if collection.settings.contains_key("id") {
                let schemas = scope.context.raw.merged.get("schemas");

                return Ok(tree_nodes_id_param(collection, schemas).is_none());
            }
        }

        at = current.parent;
    }

    Ok(false)
}
// The method and the path, each placeholder compared by position only: `/tasks/{id}` and `/tasks/{taskId}` are one
// route to a router, `/tasks/me` beside `/tasks/{id}` is not. Absent for a relay route whose target is refused.
fn route_of(operation: &DraftOperation) -> Option<Route> {
    let method = operation.method.as_ref()?.as_str().to_uppercase();
    let path = operation.path.as_ref()?;

    Some(Route {
        key: format!("{method} {}", blank_placeholders(path)),
        text: format!("{method} {path}"),
    })
}
// Two operations of one api never share a method and a path, whatever their origin.
fn report_route_clashes(
    written: &[Written<'_, '_>],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let mut by_route: HashMap<&str, &Written<'_, '_>> = HashMap::new();

    for entry in written {
        let Some(route) = &entry.route else {
            continue;
        };
        let first = by_route.get(route.key.as_str()).copied();
        let Some((first, first_route)) =
            first.and_then(|first| Some((first, first.route.as_ref()?)))
        else {
            by_route.insert(&route.key, entry);
            continue;
        };

        scope
            .context
            .report(tree_nodes_error(TreeNodesDiagnosticOptions {
                rule: TreeNodesRule::RouteUnique,
                origin: tree_nodes_node_origin(&entry.node.origin)?,
                message: format!(
                    "The operation {} answers {}, which a router cannot tell from {} of {}.",
                    entry.name.id, route.text, first_route.text, first.name.id
                ),
                fix: "Change the path or the method of one of the two routes.".to_owned(),
                related: vec![RelatedLocation {
                    origin: tree_nodes_node_origin(&first.node.origin)?,
                    message: format!("the operation {}", first.name.id),
                }],
            }));
    }

    Ok(())
}
fn operation_of(
    _site: &TreeNodesSite<'_, '_>,
    _name: &TreeNodesOperationName,
    _prefixes: &TreeNodesSurfacePrefixes,
    _scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    Err(not_ported_yet("operationOf"))
}

fn relay_operation_of<'node, 'raw>(
    _site: &TreeNodesSite<'node, 'raw>,
    _name: &TreeNodesOperationName,
    _prefixes: &TreeNodesSurfacePrefixes,
    _relay_declarations: &mut Vec<TreeNodesRelayDeclaration<'node, 'raw>>,
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

fn surface_of(node_id: TreeNodeId, nodes: &TreeNodes<'_>) -> Result<String, InternalError> {
    let root = nodes
        .chain(node_id)?
        .first()
        .map(|(_, root)| root.name.clone());

    root.ok_or_else(|| InternalError::new("a tree node has no root"))
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

// Ids are unique across the api, and two operations whose names give equal segments would collide in every
// language.
fn report_clashes(
    written: &[Written<'_, '_>],
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let mut by_id: HashMap<&str, &Written<'_, '_>> = HashMap::new();
    let mut by_segments: HashMap<String, &Written<'_, '_>> = HashMap::new();

    for entry in written {
        let id = entry.name.id.as_str();

        if let Some(same_id) = by_id.get(id) {
            report_clash(entry, same_id, ClashRule::OperationIdUnique, scope)?;
            continue;
        }

        by_id.insert(id, entry);

        let segments = entry.name.name.segments.join(" ");

        if let Some(same_name) = by_segments.get(&segments) {
            report_clash(entry, same_name, ClashRule::OperationNameUnique, scope)?;
        } else {
            by_segments.insert(segments, entry);
        }
    }

    Ok(())
}
fn report_clash(
    entry: &Written<'_, '_>,
    first: &Written<'_, '_>,
    rule: ClashRule,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let id = &entry.name.id;
    let first_id = &first.name.id;
    let message = match rule {
        ClashRule::OperationIdUnique => format!(
            "The operation id {id} of {} is also the id of {}; operation ids are unique across the api.",
            entry.node.pointer, first.node.pointer
        ),
        ClashRule::OperationNameUnique => format!(
            "The operation {id} of {} has the same name words as {first_id} of {}, so the two collide in every language.",
            entry.node.pointer, first.node.pointer
        ),
    };

    scope
        .context
        .report(tree_nodes_error(TreeNodesDiagnosticOptions {
            rule: rule.rule(),
            origin: tree_nodes_node_origin(&entry.node.origin)?,
            message,
            fix: "Rename one of the routes, or set operationId on one of them.".to_owned(),
            related: vec![RelatedLocation {
                origin: tree_nodes_node_origin(&first.node.origin)?,
                message: format!("the operation {first_id}"),
            }],
        }));

    Ok(())
}
