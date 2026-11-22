//! The routes of the draft with their tree nodes, and the api facts the access checks read.

use seampact_json::object_of;
use std::collections::HashMap;

use seampact_diagnostics::InternalError;
use seampact_ir::{IdentityId, KnownAccessRef, OperationId};
use seampact_pipeline::{
    DraftIr, DraftOperation, OperationIndex, TreeNode, TreeNodeId, TreeNodeKind, TreeNodes,
};

use crate::read::{access_rights_member, access_rights_string};
use crate::schema_use::AccessRightsContext;

/// How a route is reached (ADR 0002 section 9): an identity is required, optional, or none.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccessRightsAccessKind {
    Identity,
    Optional,
    Public,
}

/// One operation of the draft with its tree node.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsRoute {
    pub(crate) operation: OperationIndex,
    pub(crate) id: OperationId,
    pub(crate) node: TreeNodeId,
    pub(crate) access: AccessRightsAccessKind,
    /// The `access` setting that makes the route public or optional-auth.
    pub(crate) access_pointer: Option<String>,
    /// The identity the route runs under, unless it is public.
    pub(crate) identity: Option<IdentityId>,
}

/// The caller of a service api.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsCaller {
    pub(crate) identity: String,
    pub(crate) right: String,
}

/// The api's kind and, on a service api, its caller (ADR 0002 section 5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccessRightsApi {
    pub(crate) kind: String,
    pub(crate) caller: Option<AccessRightsCaller>,
}

/// The access fields of a route, as `accessOf` answers them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AccessRightsAccess {
    pub(crate) access: AccessRightsAccessKind,
    pub(crate) access_pointer: Option<String>,
    pub(crate) identity: Option<IdentityId>,
}

/// The nearest `scope` node at or above a node, and the collection it belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AccessRightsScopeNodes {
    pub(crate) scope: TreeNodeId,
    pub(crate) collection: TreeNodeId,
}

const API_KIND_DEFAULT: &str = "product";

/// The draft operation a route stands for.
///
/// # Errors
///
/// An internal error for a route of another draft.
pub(crate) fn access_rights_operation_of<'draft>(
    context: &AccessRightsContext<'draft, '_, '_>,
    route: &AccessRightsRoute,
) -> Result<&'draft DraftOperation, InternalError> {
    let draft: &'draft DraftIr = context.draft;

    draft
        .operations
        .get(route.operation.position())
        .ok_or_else(|| {
            InternalError::new(format!(
                "operation {} is not in the draft",
                route.operation.position()
            ))
        })
}

/// The api's kind and caller, from the merged raw tree.
pub(crate) fn access_rights_api(context: &AccessRightsContext) -> AccessRightsApi {
    let api = object_of(access_rights_member(
        Some(&context.context.raw.merged),
        "api",
    ));
    let caller = object_of(access_rights_member(api, "caller"));
    let identity = access_rights_string(caller, "identity");
    let right = access_rights_string(caller, "right");

    AccessRightsApi {
        kind: access_rights_string(api, "kind")
            .unwrap_or(API_KIND_DEFAULT)
            .to_owned(),
        caller: match (identity, right) {
            (Some(identity), Some(right)) => Some(AccessRightsCaller {
                identity: identity.to_owned(),
                right: right.to_owned(),
            }),
            _ => None,
        },
    }
}

/// Every operation of the draft with its tree node, in draft order.
///
/// # Errors
///
/// An internal error for an operation whose origin is no tree node, or that has no access.
pub(crate) fn access_rights_routes(
    context: &AccessRightsContext,
    api: &AccessRightsApi,
) -> Result<Vec<AccessRightsRoute>, InternalError> {
    let nodes: HashMap<&str, TreeNodeId> = context
        .nodes
        .iter()
        .map(|(id, node)| (node.pointer.as_str(), id))
        .collect();
    let mut routes = Vec::new();

    for index in context.draft.operation_indices() {
        let operation = context
            .draft
            .operations
            .get(index.position())
            .ok_or_else(|| {
                InternalError::new(format!(
                    "operation {} is not in the draft",
                    index.position()
                ))
            })?;
        let pointer = operation
            .origin
            .as_ref()
            .map(|origin| origin.pointer.as_str());
        let node_id = pointer.and_then(|pointer| nodes.get(pointer));
        let (Some(id), Some(node_id)) = (&operation.id, node_id) else {
            return Err(InternalError::new(format!(
                "tree.nodes wrote an operation ({}) whose origin {} is no tree node",
                operation.id.as_ref().map_or("no id", OperationId::as_str),
                pointer.unwrap_or("(none)")
            )));
        };
        let access = access_of(operation, context.nodes.get(*node_id)?, api)?;

        routes.push(AccessRightsRoute {
            operation: index,
            id: id.clone(),
            node: *node_id,
            access: access.access,
            access_pointer: access.access_pointer,
            identity: access.identity,
        });
    }

    Ok(routes)
}

// access.identity writes each operation's `access` (ADR 0006 section 3), except on a relay route,
// whose access is direction-dependent: it runs under the service api's caller identity (ADR 0002
// section 7).
pub(crate) fn access_of(
    operation: &DraftOperation,
    node: &TreeNode<'_>,
    api: &AccessRightsApi,
) -> Result<AccessRightsAccess, InternalError> {
    let Some(access) = &operation.access else {
        if node.kind != TreeNodeKind::Relay {
            return Err(InternalError::new(format!(
                "access.identity wrote no access on operation {}",
                operation.id.as_ref().map_or("(no id)", OperationId::as_str)
            )));
        }

        return Ok(AccessRightsAccess {
            access: AccessRightsAccessKind::Identity,
            access_pointer: None,
            identity: api
                .caller
                .as_ref()
                .map(|caller| IdentityId::new(caller.identity.clone())),
        });
    };

    Ok(match KnownAccessRef::try_from(access)? {
        KnownAccessRef::Identity(identity) => AccessRightsAccess {
            access: AccessRightsAccessKind::Identity,
            access_pointer: None,
            identity: Some(identity.identity.clone()),
        },
        KnownAccessRef::Optional(optional) => AccessRightsAccess {
            access: AccessRightsAccessKind::Optional,
            access_pointer: Some(optional.origin.pointer.clone()),
            identity: Some(optional.identity.clone()),
        },
        KnownAccessRef::Public(public) => AccessRightsAccess {
            access: AccessRightsAccessKind::Public,
            access_pointer: Some(public.origin.pointer.clone()),
            identity: None,
        },
    })
}

/// The nearest `scope` node at or above `node`, and the collection it belongs to.
pub(crate) fn access_rights_scope_of(
    nodes: &TreeNodes<'_>,
    node: TreeNodeId,
) -> Result<Option<AccessRightsScopeNodes>, InternalError> {
    let mut at = Some(node);

    while let Some(current) = at {
        let at_node = nodes.get(current)?;

        if at_node.kind == TreeNodeKind::Scope
            && let Some(collection) = at_node.parent
        {
            return Ok(Some(AccessRightsScopeNodes {
                scope: current,
                collection,
            }));
        }

        at = at_node.parent;
    }

    Ok(None)
}

/// The collection or single a route belongs to: its nearest such ancestor (ADR 0002 section 2,
/// `{resource}`).
pub(crate) fn access_rights_resource_of(
    nodes: &TreeNodes<'_>,
    node: TreeNodeId,
) -> Result<Option<TreeNodeId>, InternalError> {
    let mut at = nodes.get(node)?.parent;

    while let Some(current) = at {
        let at_node = nodes.get(current)?;

        if matches!(
            at_node.kind,
            TreeNodeKind::Collection | TreeNodeKind::Single
        ) {
            return Ok(Some(current));
        }

        at = at_node.parent;
    }

    Ok(None)
}
