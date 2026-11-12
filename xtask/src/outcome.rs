//! The result of one gate step and its one-line report.

use std::fmt;

/// How one gate step ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepOutcome {
    /// The step ran and passed.
    Passed { step: &'static str },
    /// The step ran and failed, or could not start.
    Failed { step: &'static str },
    /// The step failed by refusing to pass, with the reason.
    FailedWithReason {
        step: &'static str,
        reason: &'static str,
    },
    /// The step has nothing to run yet, with the reason.
    NotRun {
        step: &'static str,
        reason: &'static str,
    },
}

impl StepOutcome {
    /// Whether the step makes the gate fail.
    pub fn is_failure(&self) -> bool {
        matches!(self, Self::Failed { .. } | Self::FailedWithReason { .. })
    }
}

impl fmt::Display for StepOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Passed { step } => write!(formatter, "{step}: ok"),
            Self::Failed { step } => write!(formatter, "{step}: failed"),
            Self::FailedWithReason { step, reason } => {
                write!(formatter, "{step}: failed: {reason}")
            }
            Self::NotRun { step, reason } => write!(formatter, "{step}: not run: {reason}"),
        }
    }
}
