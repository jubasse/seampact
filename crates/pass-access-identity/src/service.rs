//! A service api: its caller identity, which every route of it runs under, and the nodes that
//! name another identity.

use seampact_authoring::RawApi;
use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, stringify_json};
use seampact_pipeline::{TreeNodes, pointer_below};

use crate::read::{access_identity_object, access_identity_string};
use crate::report::{AccessIdentityOnceReporter, AccessIdentityProblem, AccessIdentityRule};

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
    nodes: &TreeNodes<'_>,
    caller: &str,
    reporter: &mut AccessIdentityOnceReporter<'_, '_, '_>,
) -> Result<(), InternalError> {
    for (_, node) in nodes.iter() {
        let Some(written) = node.settings.get("identity") else {
            continue;
        };

        if matches!(written, JsonValue::String(name) if name == caller) {
            continue;
        }

        reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::ServiceIdentity,
            message: format!(
                "{} '{}' of a service api sets identity {}, while every route of the api runs under its caller identity '{caller}'",
                node.kind.as_str(),
                node.name,
                stringify_json(written)
            ),
            fix: "Remove the identity: the routes of a service api run under 'api.caller.identity', which surfaces need not repeat.".to_owned(),
            pointer: pointer_below(&node.pointer, &["identity"]),
            related: Vec::new(),
        })?;
    }

    Ok(())
}
