//! The error of a write: a bug, or the system refusing a file.

use seampact_diagnostics::InternalError;

/// What stops a write before it answers: a bug, or a file the system refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WriterError {
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

impl WriterError {
    /// An [`WriterError::Io`] for `path` from the system's `error`.
    pub(crate) fn io(path: &camino::Utf8Path, error: &std::io::Error) -> Self {
        Self::Io {
            path: path.to_string(),
            message: error.to_string(),
        }
    }
}
