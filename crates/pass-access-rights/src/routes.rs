//! The routes of the draft with their tree nodes, and the api facts the access checks read.

use std::collections::HashMap;

use seampact_diagnostics::InternalError;
use seampact_ir::{IdentityId, KnownAccessRef, OperationId};
use seampact_pipeline::{
    DraftOperation, OperationIndex, PassError, TreeNode, TreeNodeId, TreeNodeKind, TreeNodes,
};

use crate::not_ported::not_ported_yet;
use crate::read::{access_rights_member, access_rights_object, access_rights_string};
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

/// The api's kind and caller, from the merged raw tree.
pub(crate) fn access_rights_api(context: &AccessRightsContext) -> AccessRightsApi {
    let api = access_rights_object(access_rights_member(Some(&context.context.raw.merged), "api"));
    let caller = access_rights_object(access_rights_member(api, "caller"));
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
                InternalError::new(format!("operation {} is not in the draft", index.position()))
            })?;
        let pointer = operation.origin.as_ref().map(|origin| origin.pointer.as_str());
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

pub(crate) fn access_rights_scope_of(
    _nodes: &TreeNodes<'_>,
    _node: TreeNodeId,
) -> Result<Option<AccessRightsScopeNodes>, PassError> {
    Err(not_ported_yet("accessRightsScopeOf"))
}

pub(crate) fn access_rights_resource_of(
    _nodes: &TreeNodes<'_>,
    _node: TreeNodeId,
) -> Result<Option<TreeNodeId>, PassError> {
    Err(not_ported_yet("accessRightsResourceOf"))
}
