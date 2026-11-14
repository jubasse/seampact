//! The parameters a route declares, as access reads them: a binding's or a signature key's source
//! among them, and a query scheme's parameter, which is never a declared query field.

use seampact_ir::Scheme;
use seampact_pipeline::{DraftOperation, PassError, pointer_below};

use crate::access::{
    AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope,
    access_identity_access_schemes,
};
use crate::not_ported::not_ported_yet;
use crate::report::{AccessIdentityProblem, AccessIdentityRelated, AccessIdentityRule};

/// Where a route declares parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AccessIdentityParameterLocation {
    Path,
    Query,
    Header,
}

/// The parameter locations by name.
pub(crate) const PARAMETER_LOCATIONS: &[&str] = &["path", "query", "header"];

/// The location a value source's location names, when a route declares parameters there.
pub(crate) fn access_identity_is_parameter_location(
    _location: &str,
) -> Result<Option<AccessIdentityParameterLocation>, PassError> {
    Err(not_ported_yet("accessIdentityIsParameterLocation"))
}

/// Whether the operation declares the parameter; header names compare without case (RFC 9110).
pub(crate) fn access_identity_route_has_parameter(
    _operation: &DraftOperation,
    _location: AccessIdentityParameterLocation,
    _name: &str,
) -> Result<bool, PassError> {
    Err(not_ported_yet("accessIdentityRouteHasParameter"))
}

/// Reports a declared query field named as a query scheme's parameter the route accepts.
pub(crate) fn access_identity_check_query_schemes(
    route: &AccessIdentityRoute<'_, '_>,
    resolved: &AccessIdentityResolved<'_>,
    scope: &mut AccessIdentityScope<'_, '_, '_>,
) -> Result<(), PassError> {
    let Some(schemes) = access_identity_access_schemes(&resolved.access)? else {
        return Ok(());
    };
    let built = scope.built;

    for id in schemes {
        let Some(Scheme::Query(scheme)) = built.schemes.get(id) else {
            continue;
        };

        if !access_identity_route_has_parameter(
            route.operation,
            AccessIdentityParameterLocation::Query,
            &scheme.name,
        )? {
            continue;
        }

        scope.reporter.error(AccessIdentityProblem {
            rule: AccessIdentityRule::SchemeQueryField,
            message: format!(
                "route '{}' declares query field '{}', which query scheme '{id}' it accepts reads as its credential",
                route.id, scheme.name
            ),
            fix: "Rename the query field or the scheme's parameter: a query scheme's parameter is never a declared query field.".to_owned(),
            pointer: route.node.pointer.clone(),
            related: vec![AccessIdentityRelated {
                pointer: pointer_below("", &["schemes", id.as_str(), "name"]),
                message: "the scheme's parameter".to_owned(),
            }],
        })?;
    }

    Ok(())
}
