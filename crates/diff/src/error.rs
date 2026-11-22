//! The error of the contract diff: a function not ported yet, a bug.

use seampact_diagnostics::InternalError;
use seampact_diff_table::DiffTableError;

/// What stops the contract diff: a stub reached, invalid options, a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DiffError {
    /// A stub was reached: the TypeScript function `function` is not ported yet.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript function name.
        function: &'static str,
    },
    /// The diff options are invalid.
    #[error(transparent)]
    Options(#[from] DiffTableError),
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
