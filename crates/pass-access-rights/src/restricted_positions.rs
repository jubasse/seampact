//! The positions a field restriction is refused at: route params, headers and error params.

use seampact_diagnostics::access_rights_quoted;
use seampact_ir::{Origin, TypeUse};
use seampact_pipeline::{PassError, pointer_below};

use crate::not_ported::not_ported_yet;
use crate::read::{access_rights_entries, access_rights_member};
use crate::restricted_fields::{
    AccessRightsDraftSchemas, AccessRightsPositionWalk, AccessRightsRefusedPosition,
    access_rights_refuse_restrictions_below,
};
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

/// Refuses a restricted field reached from the params of an error the contract declares, whatever
/// route answers it.
pub(crate) fn access_rights_refuse_error_params(
    context: &AccessRightsContext,
    walk: &mut AccessRightsPositionWalk<'_, '_>,
) -> Result<(), PassError> {
    let merged = Some(&context.context.raw.merged);

    for (code, error) in access_rights_entries(merged, "errors") {
        if access_rights_member(Some(error), "params").is_none() {
            continue;
        }

        let pointer = pointer_below("/errors", &[code, "params"]);
        let position = AccessRightsRefusedPosition {
            text: format!("the params of error '{}'", access_rights_quoted(code)),
            pointer: Some(pointer.clone()),
        };
        let params_use = error_params_use(context, walk.schemas, &pointer)?;

        access_rights_refuse_restrictions_below(walk, &params_use, &position)?;
    }

    Ok(())
}

pub(crate) fn error_params_use(
    _context: &AccessRightsContext,
    _schemas: &AccessRightsDraftSchemas,
    _pointer: &str,
) -> Result<TypeUse, PassError> {
    Err(not_ported_yet("errorParamsUse"))
}
