//! The error of a run of generate or check: a bug, or the system refusing a file.

use seampact_bundle::BundleError;
use seampact_bundle_fetch::BundleFetchError;
use seampact_cli_config::CliConfigError;
use seampact_diagnostics::InternalError;
use seampact_openapi::OpenApiError;
use seampact_target::CompatibilityError;
use seampact_writer::WriterError;

/// What stops a run before it answers: a bug, or a file the system refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GenerateError {
    /// A file or directory could not be read or written.
    #[error("{path}: {message}")]
    Io {
        /// The path, as the run names it.
        path: String,
        /// What the system answered.
        message: String,
    },
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
    /// The config reading stopped.
    #[error(transparent)]
    Config(#[from] CliConfigError),
    /// A bundle could not be fetched or compiled with its imports.
    #[error(transparent)]
    Fetch(#[from] BundleFetchError),
    /// The OpenAPI documents could not be rendered.
    #[error(transparent)]
    OpenApi(#[from] OpenApiError),
    /// The compatibility data could not be read.
    #[error(transparent)]
    Compatibility(#[from] CompatibilityError),
    /// A local bundle could not be read.
    #[error(transparent)]
    Bundle(#[from] BundleError),
}

impl From<WriterError> for GenerateError {
    fn from(error: WriterError) -> Self {
        match error {
            WriterError::Io { path, message } => Self::Io { path, message },
            WriterError::Internal(internal) => Self::Internal(internal),
        }
    }
}
