//! The error of the diff table: a function not ported yet, a bug.

use seampact_diagnostics::InternalError;

/// What stops the diff table: a stub reached, a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DiffTableError {
    /// A stub was reached: the TypeScript function `function` is not ported yet.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript function name.
        function: &'static str,
    },
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
