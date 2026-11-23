//! What stops a step of the run planning: a refusal the user fixes, or a failure of the run.

use seampact_cli_config::{CliProblem, Problems};

use crate::GenerateError;

/// What stops a step that reads files or plans from a config.
#[derive(Debug, Clone, PartialEq)]
pub enum Stop {
    /// The config or the contract is refused with these problems.
    Refused(Problems),
    /// The run fails: a file, a bug or a function not ported yet.
    Failed(GenerateError),
}

impl From<Problems> for Stop {
    fn from(problems: Problems) -> Self {
        Self::Refused(problems)
    }
}

impl<Failure: Into<GenerateError>> From<Failure> for Stop {
    fn from(failure: Failure) -> Self {
        Self::Failed(failure.into())
    }
}

/// The value of `step`, or `None` after adding its refusals to `refused`, so a run reports the
/// problems of every step it can still take; a failure stops the run.
///
/// # Errors
///
/// The [`GenerateError`] of a failed step.
pub(crate) fn gather<Value>(
    step: Result<Value, Stop>,
    refused: &mut Vec<CliProblem>,
) -> Result<Option<Value>, GenerateError> {
    match step {
        Ok(value) => Ok(Some(value)),
        Err(Stop::Refused(problems)) => {
            refused.extend(problems);

            Ok(None)
        }
        Err(Stop::Failed(failure)) => Err(failure),
    }
}
