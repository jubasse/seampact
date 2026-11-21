//! The paging of an operation: the default limit its parameters carry.

use seampact_ir::{Operation, PagingRole, TypeUse, WireFormat};
use seampact_json::{JsonObject, JsonValue};
use seampact_target::IrLocation;

use crate::OpenApiError;
use crate::emit_context::EmitContext;
use crate::json_value::optional_integer;
use crate::not_ported::not_ported_yet;
use crate::parameters::ParameterPlace;

/// The default limit of the operation when the parameter `name` in `place` is its limit role.
pub(crate) fn paging_limit_default(
    context: &EmitContext<'_>,
    operation: &Operation,
    place: ParameterPlace,
    name: &str,
) -> Option<JsonValue> {
    let paging = operation.paging.as_ref()?;
    let style = context.ir.pagings.get(paging.style.as_ref()?.as_str())?;
    let limit_role = style
        .request
        .iter()
        .find(|role| role.role == PagingRole::Limit)?;

    if limit_role.r#in.as_str() != place.as_str() || limit_role.name != name {
        return None;
    }

    optional_integer(paging.default_limit)
}

pub(crate) fn write_paging(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _target: &mut JsonObject,
    _location: &IrLocation,
) -> Result<(), OpenApiError> {
    Err(not_ported_yet("writePaging"))
}

pub(crate) fn page_body_schema(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _format: &WireFormat,
    _item_use: &TypeUse,
    _item_schema: JsonObject,
    _status: i64,
    _location: &IrLocation,
) -> Result<Option<JsonObject>, OpenApiError> {
    Err(not_ported_yet("pageBodySchema"))
}
