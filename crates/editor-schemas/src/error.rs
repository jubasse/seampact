//! The error of the editor schemas: a bug or the environment.

use seampact_cli_config::CliConfigError;
use seampact_diagnostics::InternalError;

/// What stops the editor schemas: a bug, or the environment.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EditorSchemasError {
    /// A symbolic link check failed.
    #[error(transparent)]
    Config(#[from] CliConfigError),
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
