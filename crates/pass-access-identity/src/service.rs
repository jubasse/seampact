//! A service api: its caller identity, which every route of it runs under, and the nodes that
//! name another identity.

use seampact_authoring::RawApi;
use seampact_pipeline::{PassError, TreeNodes};

use crate::not_ported::not_ported_yet;
use crate::read::{access_identity_object, access_identity_string};
use crate::report::AccessIdentityReporter;

/// Where a service api states its caller identity.
pub(crate) const ACCESS_IDENTITY_SERVICE_CALLER_POINTER: &str = "/api/caller/identity";

/// The caller identity of a service api, at `api.caller.identity`; `None` for a product api.
pub(crate) fn access_identity_service_caller(raw: &RawApi) -> Option<&str> {
    let api = access_identity_object(&raw.merged, "api")?;
    let caller = access_identity_object(api, "caller")?;

    access_identity_string(caller, "identity")
}

/// Reports every node of a service api that sets an identity other than the caller's.
pub(crate) fn access_identity_service_nodes(
    _nodes: &TreeNodes<'_>,
    _caller: &str,
    _reporter: &mut AccessIdentityReporter<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("accessIdentityServiceNodes"))
}
