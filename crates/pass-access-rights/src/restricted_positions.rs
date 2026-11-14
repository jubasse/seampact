//! The positions a field restriction is refused at: route params, headers and error params.

use seampact_ir::{Origin, TypeUse};
use seampact_pipeline::PassError;

use crate::not_ported::not_ported_yet;
use crate::restricted_fields::{AccessRightsDraftSchemas, AccessRightsPositionWalk};
use crate::routes::AccessRightsRoute;
use crate::schema_use::AccessRightsContext;

/// A named, typed position of the draft with the origin it was written at, if any.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Positioned {
    pub(crate) name: String,
    pub(crate) type_use: TypeUse,
    pub(crate) origin: Option<Origin>,
}

pub(crate) fn authored_pointer(_origin: Option<&Origin>) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("authoredPointer"))
}

pub(crate) fn optional_pointer(_pointer: Option<&str>) -> Result<Option<String>, PassError> {
    Err(not_ported_yet("optionalPointer"))
}

pub(crate) fn access_rights_refuse_route_positions(
    _walk: &mut AccessRightsPositionWalk<'_, '_>,
    _route: &AccessRightsRoute,
) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsRefuseRoutePositions"))
}

pub(crate) fn access_rights_refuse_error_params(
    _context: &AccessRightsContext,
    _walk: &mut AccessRightsPositionWalk<'_, '_>,
) -> Result<(), PassError> {
    Err(not_ported_yet("accessRightsRefuseErrorParams"))
}

pub(crate) fn error_params_use(
    _context: &AccessRightsContext,
    _schemas: &AccessRightsDraftSchemas,
    _pointer: &str,
) -> Result<TypeUse, PassError> {
    Err(not_ported_yet("errorParamsUse"))
}
