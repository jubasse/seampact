//! What stops a read of the CLI: problems the user fixes, or a failure of the run.

use seampact_cli_config::Problems;

use crate::CliError;

/// What stops a read that gives a value.
#[derive(Debug)]
pub(crate) enum Stop {
    /// The input is refused with these problems.
    Refused(Problems),
    /// The run fails: a file or a bug.
    Failed(CliError),
}

impl From<Problems> for Stop {
    fn from(problems: Problems) -> Self {
        Self::Refused(problems)
    }
}

impl<Failure: Into<CliError>> From<Failure> for Stop {
    fn from(failure: Failure) -> Self {
        Self::Failed(failure.into())
    }
}
