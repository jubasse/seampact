//! The error of the diff table: a function not ported yet, a bug.

use seampact_diagnostics::InternalError;

/// What stops the diff table: a stub reached, a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DiffTableError {
    /// A stub was reached: the TypeScript function `function` is not ported yet; the crate has
    /// none left, the variant stays until `seampact-cli` stops matching it.
    #[error("not ported yet: {function}")]
    NotPortedYet {
        /// The TypeScript function name.
        function: &'static str,
    },
    /// The diff options hold a `today` that is not a calendar date.
    #[error("diff options: today is {today}, not a calendar date. Fix: pass today as YYYY-MM-DD.")]
    InvalidToday {
        /// The date as JSON text, quotes included.
        today: String,
    },
    /// A bug.
    #[error(transparent)]
    Internal(#[from] InternalError),
}
