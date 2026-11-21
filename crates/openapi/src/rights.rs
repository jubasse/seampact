//! The rights an operation requires, as the extensions write them.

use seampact_ir::Operation;
use seampact_json::JsonObject;
use seampact_target::IrLocation;

use crate::OpenApiError;
use crate::emit_context::EmitContext;
use crate::not_ported::not_ported_yet;

pub(crate) fn write_operation_rights(
    _context: &mut EmitContext<'_>,
    _operation: &Operation,
    _target: &mut JsonObject,
    _location: &IrLocation,
) -> Result<(), OpenApiError> {
    Err(not_ported_yet("writeOperationRights"))
}
