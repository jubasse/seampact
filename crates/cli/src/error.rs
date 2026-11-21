//! The error of a command: a function not ported yet, or a bug.

use seampact_diagnostics::InternalError;

/// What stops a command before it answers an exit code: a stub reached, or a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CliError {
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
