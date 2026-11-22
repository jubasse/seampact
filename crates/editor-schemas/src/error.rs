//! The error of the editor schemas: a bug or the environment.

use seampact_diagnostics::InternalError;

/// What stops the editor schemas: a bug, or the environment.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EditorSchemasError {
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
