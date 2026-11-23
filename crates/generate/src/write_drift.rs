//! What `check` finds when the files a run would write differ from the committed ones.

use seampact_cli_config::CliProblem;

use crate::not_ported::not_ported_yet;
use crate::{GenerateError, PlannedWrites};

/// A drift at `error` fails, at `warning` is reported, `disabled` is not looked for.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WriteDrift {
    /// A drift of a check at `error`, or a refusal that is not a drift.
    pub errors: Vec<CliProblem>,
    /// A drift of a check at `warning`.
    pub warnings: Vec<CliProblem>,
}

/// Compares every planned write with the files on disk.
///
/// # Errors
///
/// [`GenerateError::NotPortedYet`] until the function is ported.
pub fn find_write_drift(_writes: &PlannedWrites) -> Result<WriteDrift, GenerateError> {
    Err(not_ported_yet("findWriteDrift"))
}
