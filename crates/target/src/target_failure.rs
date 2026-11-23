//! What a generator answers when it cannot write: a refusal or a bug.

use std::fmt;

use seampact_diagnostics::InternalError;

use crate::Refused;

/// Why a generator wrote nothing: a form it cannot write, or a state its own plan made impossible.
#[derive(Debug, Clone, PartialEq, Eq)]
#[must_use]
pub enum TargetFailure {
    /// The refusals of forms the target cannot write; they reach the user.
    Refused(Refused),
    /// A bug: a state the target's own plan already refused.
    Internal(InternalError),
}

impl fmt::Display for TargetFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Refused(refused) => refused.fmt(formatter),
            Self::Internal(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for TargetFailure {}

impl From<Refused> for TargetFailure {
    fn from(refused: Refused) -> Self {
        Self::Refused(refused)
    }
}

impl From<InternalError> for TargetFailure {
    fn from(error: InternalError) -> Self {
        Self::Internal(error)
    }
}
