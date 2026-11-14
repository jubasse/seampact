//! The routes of the draft with their tree nodes, and the api facts the access checks read.

use seampact_ir::{IdentityId, OperationId};
use seampact_pipeline::{OperationIndex, PassError, TreeNode, TreeNodeId, TreeNodes};

use crate::not_ported::not_ported_yet;
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

pub(crate) fn access_rights_api(
    _context: &AccessRightsContext,
) -> Result<AccessRightsApi, PassError> {
    Err(not_ported_yet("accessRightsApi"))
}

pub(crate) fn access_rights_routes(
    _context: &AccessRightsContext,
    _api: &AccessRightsApi,
) -> Result<Vec<AccessRightsRoute>, PassError> {
    Err(not_ported_yet("accessRightsRoutes"))
}

pub(crate) fn access_of(
    _context: &AccessRightsContext,
    _operation: OperationIndex,
    _node: &TreeNode<'_>,
    _api: &AccessRightsApi,
) -> Result<AccessRightsAccess, PassError> {
    Err(not_ported_yet("accessOf"))
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
