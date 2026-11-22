//! The error of the contract diff: invalid options, a bug.

use seampact_diagnostics::InternalError;
use seampact_diff_table::DiffTableError;

/// What stops the contract diff: invalid options, a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DiffError {
    /// The diff options are invalid.
    #[error(transparent)]
    Options(#[from] DiffTableError),
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
