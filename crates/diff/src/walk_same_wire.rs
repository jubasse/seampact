//! Whether two schemas, enums or type uses of two IRs are one thing on the wire.

use seampact_ir::ContractIr;

use crate::DiffError;
use crate::not_ported::not_ported_yet;

/// Whether the schema `before_id` of `before` and `after_id` of `after` have one wire shape.
///
/// # Errors
///
/// Not ported yet.
pub(crate) fn is_same_wire_schema(
    _before: &ContractIr,
    _before_id: &str,
    _after: &ContractIr,
    _after_id: &str,
) -> Result<bool, DiffError> {
    Err(not_ported_yet("isSameWireSchema"))
}
