//! The error of a command: a function not ported yet, a bug, or the environment refusing a file.

use seampact_bundle::BundleError;
use seampact_bundle_fetch::BundleFetchError;
use seampact_cli_config::CliConfigError;
use seampact_diagnostics::InternalError;
use seampact_diff::DiffError;
use seampact_editor_schemas::EditorSchemasError;
use seampact_generate::GenerateError;
use seampact_lint::LintError;

/// What stops a command before it answers an exit code: a stub reached, a bug, or a file the
/// system refused.
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
    /// A file or directory of the command could not be read or written.
    #[error("{path}: {message}")]
    Io {
        /// The path, as the command names it.
        path: String,
        /// What the system answered.
        message: String,
    },
    /// The config reading stopped.
    #[error(transparent)]
    Config(#[from] CliConfigError),
    /// A bundle could not be fetched or compiled with its imports.
    #[error(transparent)]
    Fetch(#[from] BundleFetchError),
    /// A bundle could not be built or written.
    #[error(transparent)]
    Bundle(#[from] BundleError),
    /// The lint stopped.
    #[error(transparent)]
    Lint(#[from] LintError),
    /// The editor schemas could not be planned or written.
    #[error(transparent)]
    EditorSchemas(#[from] EditorSchemasError),
    /// The diff stopped.
    #[error(transparent)]
    Diff(#[from] DiffError),
}

impl From<GenerateError> for CliError {
    fn from(error: GenerateError) -> Self {
        match error {
            GenerateError::NotPortedYet { function } => Self::NotPortedYet { function },
            GenerateError::Io { path, message } => Self::Io { path, message },
            GenerateError::Internal(internal) => Self::Internal(internal),
            GenerateError::Fetch(fetch) => Self::Fetch(fetch),
            GenerateError::Bundle(bundle) => Self::Bundle(bundle),
        }
    }
}

impl CliError {
    /// A file the system refused, named by `path`.
    pub(crate) fn io(path: impl std::fmt::Display, error: &std::io::Error) -> Self {
        Self::Io {
            path: path.to_string(),
            message: error.to_string(),
        }
    }
}
