//! The operations of the api tree: one per operation node, with its name, route, shape and lifecycle, and the clash checks.

use std::collections::HashMap;
use std::mem;

use seampact_diagnostics::{InternalError, RelatedLocation};
use seampact_ir::{
    FormatId, HttpMethod, IrMap, OpShorthand, OperationId, OperationResource, Params, ServiceId,
    SurfaceId, TypeUse,
};
use seampact_json::JsonValue;
use seampact_pass_tree_shared::{
    TREE_NODES_BATCH_OP, TREE_NODES_OPERATION_KIND, TreeNodesOperationName, tree_nodes_id_param,
    tree_nodes_idless_collection, tree_nodes_is_operation, tree_nodes_op_shorthand,
    tree_nodes_operation_name, tree_nodes_singular_is_bare_id, tree_nodes_singular_owner,
    tree_nodes_text,
};
use seampact_pipeline::{DraftOperation, PassError, TreeNode, TreeNodeId, TreeNodeKind, TreeNodes};

use crate::api::TreeNodesSurfacePrefixes;
use crate::api::tree_nodes_docs_of_object;
use crate::collections::tree_nodes_report_idless_collection;
use crate::degradable::tree_nodes_degradable;
use crate::diagnostics::{
    TreeNodesDiagnosticOptions, TreeNodesRule, tree_nodes_error, tree_nodes_node_origin,
    tree_nodes_report_once, tree_nodes_warning,
};
use crate::examples::tree_nodes_examples;
use crate::fields::TreeNodesSite;
use crate::input::{tree_nodes_batch_input, tree_nodes_input};
use crate::lifecycle::{
    tree_nodes_budget_ms, tree_nodes_check_successor, tree_nodes_deprecated, tree_nodes_extensions,
    tree_nodes_internal, tree_nodes_stated_maturity, tree_nodes_tags, tree_nodes_upstream,
};
use crate::not_ported::not_ported_yet;
use crate::paging::tree_nodes_paging;
use crate::params::{blank_placeholders, tree_nodes_params, tree_nodes_unknown_query};
use crate::pass::TreeNodesScope;
use crate::paths::{tree_nodes_check_path_parts, tree_nodes_path};
use crate::relays::{TreeNodesRelayDeclaration, tree_nodes_relay_shape};
use crate::responses::{tree_nodes_format, tree_nodes_responses};
use crate::writes::{tree_nodes_concurrency, tree_nodes_owner};

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

        warn_bare_id_singular(node, nodes, scope)?;

        let site = TreeNodesSite {
            node_id,
            node,
            nodes,
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
    site: &TreeNodesSite<'_, '_>,
    name: &TreeNodesOperationName,
    prefixes: &TreeNodesSurfacePrefixes,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    let node = site.node;
    let op = tree_nodes_op_shorthand(node);
    let resource = resource_of(node, site.nodes, scope.context.raw.merged.get("schemas"))?;
    let method = method_of(node, op.as_ref(), scope)?;
    let safe = method == SAFE_METHOD || op == Some(TREE_NODES_BATCH_OP);
    let writes_input = node.settings.contains_key("input");
    let input = if op == Some(TREE_NODES_BATCH_OP) && !writes_input {
        tree_nodes_batch_input(node, scope)?
    } else {
        tree_nodes_input(node, &name.id, scope)?
    };

    if let Some(op) = &op
        && OPS_NEEDING_INPUT.contains(op)
        && !writes_input
    {
        report_no_input(site, op, scope)?;
    }

    if method == SAFE_METHOD && writes_input {
        report_get_input(site, scope)?;
    }

    let path = tree_nodes_path(node, site.nodes, prefixes, scope)?;

    tree_nodes_check_path_parts(site, &path, scope)?;

    let input_schema = input.as_ref().map(|input| &input.schema);
    let params = tree_nodes_params(site, Some(&path), safe, input_schema, scope)?;
    let unknown_query = tree_nodes_unknown_query(site, scope)?;
    let shape = shape_of(site, input_schema, &params, scope)?;
    let lifecycle = lifecycle_of(site, scope)?;

    Ok(with_lifecycle(
        DraftOperation {
            kind: Some(TREE_NODES_OPERATION_KIND),
            id: Some(OperationId::new(name.id.clone())),
            name: Some(name.name.clone()),
            surface: Some(SurfaceId::new(surface_of(site.node_id, site.nodes)?)),
            op,
            resource,
            method: Some(method),
            safe: Some(safe),
            path: Some(path.full),
            params: Some(params),
            unknown_query: Some(unknown_query),
            input,
            origin: Some(node.origin.clone()),
            ..with_shape(DraftOperation::default(), shape)
        },
        lifecycle,
    ))
}

// A relay route's method, path, params, input and shape are copied from the operation it relays; a refused target
// leaves it with empty params and responses (reported).
fn relay_operation_of<'node, 'raw>(
    site: &TreeNodesSite<'node, 'raw>,
    name: &TreeNodesOperationName,
    prefixes: &TreeNodesSurfacePrefixes,
    relay_declarations: &mut Vec<TreeNodesRelayDeclaration<'node, 'raw>>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    let node = site.node;
    let surface = surface_of(site.node_id, site.nodes)?;
    let Some(prefix) = prefixes.get(&surface) else {
        return Err(InternalError::new(format!("the surface {surface} has no prefix")).into());
    };
    let copied =
        tree_nodes_relay_shape(site, prefix, relay_declarations, scope)?.unwrap_or_default();
    let unknown_query = tree_nodes_unknown_query(site, scope)?;
    let lifecycle = lifecycle_of(site, scope)?;

    Ok(with_lifecycle(
        DraftOperation {
            kind: Some(TREE_NODES_OPERATION_KIND),
            id: Some(OperationId::new(name.id.clone())),
            name: Some(name.name.clone()),
            surface: Some(SurfaceId::new(surface)),
            params: copied.params.or_else(|| Some(empty_params())),
            responses: copied.responses.or_else(|| Some(Vec::new())),
            unknown_query: Some(unknown_query),
            examples: Some(IrMap::new()),
            origin: Some(node.origin.clone()),
            ..copied
        },
        lifecycle,
    ))
}

fn empty_params() -> Params {
    Params {
        path: Vec::new(),
        query: Vec::new(),
        header: Vec::new(),
    }
}

// The members a route's own shape gives: format, responses, write semantics, paging, degradable and examples.
fn shape_of(
    site: &TreeNodesSite<'_, '_>,
    input: Option<&TypeUse>,
    params: &Params,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    let format = tree_nodes_format(site, scope)?;
    let responses = tree_nodes_responses(site, &format, scope)?;
    let owner = tree_nodes_owner(site, scope)?;
    let concurrency = tree_nodes_concurrency(site, input, params, scope)?;
    let paging = tree_nodes_paging(site, &responses, &params.query, scope)?;
    let degradable = tree_nodes_degradable(site, &format, &responses, scope)?;
    let examples = tree_nodes_examples(site, input, &responses, scope)?;

    Ok(DraftOperation {
        responses: Some(responses),
        concurrency,
        owner,
        paging,
        degradable,
        format: Some(FormatId::new(format)),
        examples: Some(examples.into_iter().collect()),
        ..DraftOperation::default()
    })
}

/// The base with the members `shape_of` wrote.
fn with_shape(base: DraftOperation, shape: DraftOperation) -> DraftOperation {
    DraftOperation {
        responses: shape.responses,
        concurrency: shape.concurrency,
        owner: shape.owner,
        paging: shape.paging,
        degradable: shape.degradable,
        format: shape.format,
        examples: shape.examples,
        ..base
    }
}

// The lifecycle members (ADR 0002 section 10), docs and extensions, on every operation, a relay route's too.
fn lifecycle_of(
    site: &TreeNodesSite<'_, '_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<DraftOperation, PassError> {
    let budget_ms = tree_nodes_budget_ms(site, scope)?;
    let deprecated = tree_nodes_deprecated(site, scope)?;
    let maturity = tree_nodes_stated_maturity(site, scope)?;
    let upstream: Vec<ServiceId> = tree_nodes_upstream(site, scope)?
        .into_iter()
        .map(ServiceId::new)
        .collect();
    let internal = tree_nodes_internal(site, scope)?;
    let tags = tree_nodes_tags(site, scope)?;

    Ok(DraftOperation {
        budget_ms,
        deprecated,
        upstream: Some(upstream),
        maturity,
        internal: Some(internal),
        tags: Some(tags),
        docs: Some(tree_nodes_docs_of_object(site.node.settings)),
        extensions: Some(tree_nodes_extensions(site.node_id, site.nodes)?),
        ..DraftOperation::default()
    })
}

/// The base with the members `lifecycle_of` wrote.
fn with_lifecycle(base: DraftOperation, lifecycle: DraftOperation) -> DraftOperation {
    DraftOperation {
        budget_ms: lifecycle.budget_ms,
        deprecated: lifecycle.deprecated,
        upstream: lifecycle.upstream,
        maturity: lifecycle.maturity,
        internal: lifecycle.internal,
        tags: lifecycle.tags,
        docs: lifecycle.docs,
        extensions: lifecycle.extensions,
        ..base
    }
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
// The method a route writes, an op's own or `conventions.ops.<op>.method`.
fn method_of(
    node: &TreeNode<'_>,
    op: Option<&OpShorthand>,
    scope: &TreeNodesScope<'_, '_, '_>,
) -> Result<HttpMethod, PassError> {
    // The TypeScript's `??`: a written null falls through to the convention.
    let own = node
        .settings
        .get("method")
        .filter(|written| **written != JsonValue::Null);
    let convention = match (own, op) {
        (None, Some(op)) => scope
            .context
            .conventions
            .get(&format!("ops.{}.method", op.as_str()))?
            .map(|reading| reading.value),
        _ => None,
    };
    let method = own.or(convention).and_then(|written| {
        HTTP_METHODS
            .iter()
            .find(|method| is_method_text(method, written))
    });

    method.cloned().ok_or_else(|| {
        InternalError::new(format!(
            "the operation at {} has no method the grammar admits",
            node.pointer
        ))
        .into()
    })
}

fn is_method_text(method: &HttpMethod, written: &JsonValue) -> bool {
    matches!(written, JsonValue::String(text) if method.as_str() == text)
}

// The collection or single an operation belongs to (its nearest one), with the member id parameter when the
// operation sits on the member scope, and the item property holding the id: `idProperty`, else the id parameter.
fn resource_of(
    node: &TreeNode<'_>,
    nodes: &TreeNodes<'_>,
    schemas: Option<&JsonValue>,
) -> Result<Option<OperationResource>, PassError> {
    let mut on_member = false;
    let mut at = node.parent;

    while let Some(at_id) = at {
        let current = nodes.get(at_id)?;

        if current.kind == TreeNodeKind::Scope {
            on_member = current.name == "member";
        }

        if !matches!(
            current.kind,
            TreeNodeKind::Collection | TreeNodeKind::Single
        ) {
            at = current.parent;
            continue;
        }

        let resource_type = tree_nodes_text(current, "resourceType").unwrap_or(&current.name);

        if current.kind == TreeNodeKind::Single {
            return Ok(Some(OperationResource {
                r#type: resource_type.to_owned(),
                id_param: None,
                id_property: None,
            }));
        }

        let id_param = tree_nodes_id_param(current, schemas);
        let id_property = tree_nodes_text(current, "idProperty")
            .map(str::to_owned)
            .or_else(|| id_param.clone());

        return Ok(Some(OperationResource {
            r#type: resource_type.to_owned(),
            id_param: if on_member { id_param } else { None },
            id_property,
        }));
    }

    Ok(None)
}

// A collection whose id parameter is `id` and sets no `singular` names its member operations `getId`, `createId`.
// Warned once per collection, at its first operation that takes the singular.
fn warn_bare_id_singular(
    node: &TreeNode<'_>,
    nodes: &TreeNodes<'_>,
    scope: &mut TreeNodesScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(collection) = tree_nodes_singular_owner(nodes, node)? else {
        return Ok(());
    };

    if !tree_nodes_singular_is_bare_id(collection, scope.context.raw.merged.get("schemas")) {
        return Ok(());
    }

    let key = format!("collection-singular-bare-id:{}", collection.pointer);
    let diagnostic = tree_nodes_warning(TreeNodesDiagnosticOptions {
        rule: TreeNodesRule::CollectionSingular,
        origin: tree_nodes_node_origin(&collection.origin)?,
        message: format!(
            "The collection {} has the id parameter id and no singular, so its operation ids read getId and createId.",
            collection.name
        ),
        fix: "Set singular on the collection (the noun of its operation ids), or name its id parameter with the noun, as in productId.".to_owned(),
        related: Vec::new(),
    });

    tree_nodes_report_once(&key, diagnostic, scope);

    Ok(())
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
