//! The config of one run: an app config or a root config.

use camino::Utf8Path;

use crate::not_ported::not_ported_yet;
use crate::{CliConfigError, CliProblem};

/// The config a command runs on: one app, or a root and its apps.
///
/// Declared by the brief that ports `read-run-config.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum RunConfig {}

/// The run read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadRunConfigOutcome {
    /// The `run` member.
    Read(RunConfig),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

/// Reads the config a command runs on from `file`; `text_file` holds its text when it differs.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn read_run_config(
    _file: &Utf8Path,
    _display_name: &str,
    _text_file: Option<&Utf8Path>,
) -> Result<ReadRunConfigOutcome, CliConfigError> {
    Err(not_ported_yet("readRunConfig"))
}
