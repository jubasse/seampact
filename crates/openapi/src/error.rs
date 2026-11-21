//! The error of the OpenAPI emitter: a function not ported yet, a bug.

use seampact_diagnostics::InternalError;

/// What stops the OpenAPI emitter: a stub reached, a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum OpenApiError {
    /// A stub was reached: the TypeScript function `function` is not ported yet.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript function name.
        function: &'static str,
    },
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
