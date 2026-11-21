//! The answer of an entry function that failed: not ported yet, or broken.

use seampact_oracle::SubjectAnswer;

/// An error of an entry function that tells a stub reached from a failure; each wiring module
/// implements it for its crate's error, and the crate's last brief removes that impl.
pub(crate) trait StubError: std::fmt::Display {
    /// Whether the error is the `NotPortedYet` of a stub.
    fn is_not_ported(&self) -> bool;
}

/// [`SubjectAnswer::NotPorted`] for a stub reached, else the error as an internal error.
pub(crate) fn failed_answer<Output>(error: &impl StubError) -> SubjectAnswer<Output> {
    if error.is_not_ported() {
        return SubjectAnswer::NotPorted;
    }

    SubjectAnswer::InternalError {
        message: error.to_string(),
    }
}
