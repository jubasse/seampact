//! The OpenAPI documents of one api.

use seampact_ir::{ContractIr, DocumentId};
use seampact_target::Refusal;

use crate::not_ported::not_ported_yet;
use crate::{EmitterOptions, OpenApiError};

/// One document of an api.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmittedDocument {
    /// The `api.documents` key, absent for the one document of an api that declares none.
    pub name: Option<DocumentId>,
    /// The document as YAML: LF line ends, a final newline, keys in the emitter's order.
    pub text: String,
}

/// The documents of an api, or the refusals that stop them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmitOutcome {
    /// Every document of the api.
    Emitted(Vec<EmittedDocument>),
    /// Why no document is written, each naming the IR member and the fix.
    Refused(Vec<Refusal>),
}

/// The OpenAPI documents of an api, or the refusals that stop them.
///
/// # Errors
///
/// [`OpenApiError::NotPortedYet`] until the function is ported.
pub fn emit_documents(
    _ir: &ContractIr,
    _options: &EmitterOptions,
) -> Result<EmitOutcome, OpenApiError> {
    Err(not_ported_yet("emitDocuments"))
}
