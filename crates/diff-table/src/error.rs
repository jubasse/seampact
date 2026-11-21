//! The error of the diff table: invalid diff options, a bug.

use seampact_diagnostics::InternalError;

/// What stops the diff table: invalid diff options, a bug.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DiffTableError {
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
