//! The error of the lint: a bug.

use seampact_diagnostics::InternalError;

/// What stops the lint: a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LintError {
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
