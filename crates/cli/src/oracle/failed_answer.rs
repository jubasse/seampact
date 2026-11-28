//! The answer of an entry function that failed: a bug or the system, never a stub.

use std::fmt::Display;

use seampact_oracle::SubjectAnswer;

/// `error` as an internal error answer.
pub(crate) fn failed_answer<Output>(error: &impl Display) -> SubjectAnswer<Output> {
    SubjectAnswer::InternalError {
        message: error.to_string(),
    }
}
