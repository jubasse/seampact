//! The error of a write: a function not ported yet, a bug, or the system refusing a file.

use seampact_diagnostics::InternalError;

/// What stops a write before it answers: a stub reached, a bug, or a file the system refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WriterError {
    /// A stub was reached: the TypeScript function `function` is not ported yet.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript function name.
        function: &'static str,
    },
    /// A file or directory could not be read or written.
    #[error("{path}: {message}")]
    Io {
        /// The path, as the writer names it.
        path: String,
        /// What the system answered.
        message: String,
    },
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
