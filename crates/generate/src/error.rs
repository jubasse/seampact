//! The error of a run of generate or check: a function not ported yet, a bug, or the system
//! refusing a file.

use seampact_bundle::BundleError;
use seampact_bundle_fetch::BundleFetchError;
use seampact_cli_config::CliConfigError;
use seampact_diagnostics::InternalError;
use seampact_openapi::OpenApiError;
use seampact_target::CompatibilityError;
use seampact_writer::WriterError;

/// What stops a run before it answers: a stub reached, a bug, or a file the system refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GenerateError {
    /// A stub was reached: the TypeScript function `function` is not ported yet.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript function name.
        function: &'static str,
    },
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
    /// A bundle could not be fetched or compiled with its imports.
    #[error(transparent)]
    Fetch(#[from] BundleFetchError),
    /// A local bundle could not be read.
    #[error(transparent)]
    Bundle(#[from] BundleError),
}

impl From<WriterError> for GenerateError {
    fn from(error: WriterError) -> Self {
        match error {
            WriterError::NotPortedYet { function } => Self::NotPortedYet { function },
            WriterError::Io { path, message } => Self::Io { path, message },
            WriterError::Internal(internal) => Self::Internal(internal),
        }
    }
}

impl From<CliConfigError> for GenerateError {
    fn from(error: CliConfigError) -> Self {
        match error {
            CliConfigError::NotPortedYet { function } => Self::NotPortedYet { function },
            CliConfigError::Io { path, message } => Self::Io { path, message },
            CliConfigError::Internal(internal) => Self::Internal(internal),
        }
    }
}

impl From<OpenApiError> for GenerateError {
    fn from(error: OpenApiError) -> Self {
        match error {
            OpenApiError::Internal(internal) => Self::Internal(internal),
        }
    }
}

// The compatibility data is embedded in the binary: a file that does not read is a bug.
impl From<CompatibilityError> for GenerateError {
    fn from(error: CompatibilityError) -> Self {
        Self::Internal(InternalError::new(error.to_string()))
    }
}
