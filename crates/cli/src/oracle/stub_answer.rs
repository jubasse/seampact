//! The answer of an entry function that failed: not ported yet, or broken.

use seampact_diff_table::DiffTableError;
use seampact_openapi::OpenApiError;
use seampact_oracle::SubjectAnswer;

use crate::CliError;

/// An error of an entry function that tells a stub reached from a failure.
pub(crate) trait StubError: std::fmt::Display {
    /// Whether the error is the `NotPortedYet` of a stub.
    fn is_not_ported(&self) -> bool;
}

impl StubError for OpenApiError {
    fn is_not_ported(&self) -> bool {
        matches!(self, Self::NotPortedYet { .. })
    }
}

impl StubError for DiffTableError {
    fn is_not_ported(&self) -> bool {
        matches!(self, Self::NotPortedYet { .. })
    }
}

impl StubError for CliError {
    fn is_not_ported(&self) -> bool {
        matches!(self, Self::NotPortedYet { .. })
    }
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
