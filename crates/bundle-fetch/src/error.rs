//! The error of a bundle fetch: a bug, or the environment.

use camino::Utf8Path;
use seampact_bundle::BundleError;
use seampact_diagnostics::InternalError;

/// What stops a bundle fetch: a bug, or the environment.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BundleFetchError {
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

impl BundleFetchError {
    /// An [`Io`](Self::Io) error about `path`, with what the system answered.
    pub(crate) fn io(path: &Utf8Path, error: &std::io::Error) -> Self {
        Self::Io {
            path: path.to_string(),
            message: error.to_string(),
        }
    }
}

impl From<BundleError> for BundleFetchError {
    fn from(error: BundleError) -> Self {
        match error {
            BundleError::Internal(internal) => Self::Internal(internal),
            BundleError::Io { path, message } => Self::Io { path, message },
        }
    }
}
