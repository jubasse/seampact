//! The output of `derive.errors`.

use seampact_diagnostics::InternalError;
use seampact_ir::{ErrorCode, ErrorDecl, IrMap, NatureDecl, NatureId, OperationError};

use super::merge::{Site, operations_with, write_catalogue, write_once};
use crate::{DraftIr, Half};

/// What `derive.errors` writes: the error and nature catalogues and every operation's `errors`,
/// a relay route's copied codes included.
#[derive(Debug, Clone, PartialEq)]
pub struct DeriveErrorsOutput {
    /// The `errors` catalogue.
    pub errors: IrMap<ErrorCode, ErrorDecl>,
    /// The `natures` catalogue.
    pub natures: IrMap<NatureId, NatureDecl>,
    /// The `errors` of each draft operation, in draft order.
    pub operation_errors: Vec<Vec<OperationError>>,
}

impl DeriveErrorsOutput {
    /// The draft fields this half writes, as ADR 0006 section 3 names them.
    pub const WRITES: &'static [&'static str] = &["errors", "natures", "operations[].errors"];

    /// Moves the output into the draft.
    ///
    /// # Errors
    ///
    /// An [`InternalError`] naming the member and the operation when the draft already holds a
    /// value there, or when the output has another number of operations than the draft.
    pub fn merge_into(self, draft: &mut DraftIr) -> Result<(), InternalError> {
        let site = Site::of_draft(Half::DeriveErrors);

        write_catalogue(&mut draft.errors, self.errors, "errors", &site)?;
        write_catalogue(&mut draft.natures, self.natures, "natures", &site)?;

        for (operation, errors, site) in operations_with(
            &mut draft.operations,
            self.operation_errors,
            Half::DeriveErrors,
        )? {
            write_once(&mut operation.errors, errors, "errors", &site)?;
        }

        Ok(())
    }
}
