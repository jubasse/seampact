//! The result of one gate step and its one-line report.

use std::fmt;

/// How one gate step ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepOutcome {
    /// The step ran and passed.
    Passed { step: &'static str },
    /// The step ran and failed, or could not start.
    Failed { step: &'static str },
    /// The step was left out because an earlier step failed under fail-fast.
    NotRun {
        step: &'static str,
        reason: &'static str,
    },
}

impl StepOutcome {
    /// Whether the step makes the gate fail.
    pub fn is_failure(&self) -> bool {
        matches!(self, Self::Failed { .. })
    }

    /// The name of the step.
    pub fn step(&self) -> &'static str {
        match self {
            Self::Passed { step } | Self::Failed { step } | Self::NotRun { step, .. } => step,
        }
    }
}

/// A step's outcome with the output it produced, kept so concurrent steps print in step order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StepReport {
    pub outcome: StepOutcome,
    pub stdout: String,
    pub stderr: String,
}

impl StepReport {
    /// A step that failed with `message` as its only output.
    pub fn failed_with(step: &'static str, message: &str) -> Self {
        Self {
            outcome: StepOutcome::Failed { step },
            stdout: String::new(),
            stderr: format!("{message}\n"),
        }
    }

    /// A step left out because an earlier one failed.
    pub fn not_run(step: &'static str, reason: &'static str) -> Self {
        Self {
            outcome: StepOutcome::NotRun { step, reason },
            stdout: String::new(),
            stderr: String::new(),
        }
    }
}

impl fmt::Display for StepOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Passed { step } => write!(formatter, "{step}: ok"),
            Self::Failed { step } => write!(formatter, "{step}: failed"),
            Self::NotRun { step, reason } => write!(formatter, "{step}: not run: {reason}"),
        }
    }
}
