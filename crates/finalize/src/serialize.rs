//! The byte-stable text of the IR (ADR 0004 section 10): the canonical writer's output.

use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;

/// The IR file text: the same IR value gives the same text, whatever order its members were written in.
///
/// # Errors
///
/// An [`InternalError`] when a member does not encode as JSON.
pub fn finalize_serialize_ir(ir: &ContractIr) -> Result<String, InternalError> {
    ir.canonical_text()
        .map_err(|error| InternalError::new(error.to_string()))
}

/// The IR as its file holds it: the parse of [`finalize_serialize_ir`]'s own output, so a
/// consumer sees the IR file's member order and number forms.
///
/// # Errors
///
/// An [`InternalError`] when the written text does not read back as an IR.
pub fn finalize_canonical_ir(ir: &ContractIr) -> Result<ContractIr, InternalError> {
    ContractIr::from_json_text(&finalize_serialize_ir(ir)?)
        .map_err(|error| InternalError::new(error.to_string()))
}
