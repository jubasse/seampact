//! The error of the OpenAPI emitter: a bug.

use seampact_diagnostics::InternalError;

/// What stops the OpenAPI emitter: a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OpenApiError {
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
