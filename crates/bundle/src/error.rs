//! The error of a bundle: a function not ported yet, a bug, or the environment.

use seampact_diagnostics::InternalError;

/// What stops a bundle: a stub reached, a bug, or the environment.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BundleError {
    /// A stub was reached: the TypeScript function `function` is not ported yet.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript function name.
        function: &'static str,
    },
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
    /// A file or directory could not be read or written.
    #[error("{path}: {message}")]
    Io {
        /// The path, as the command names it.
        path: String,
        /// What the system answered.
        message: String,
    },
}
