//! The root config of a monorepo.

use camino::Utf8Path;

use crate::not_ported::not_ported_yet;
use crate::{CliConfigError, CliProblem};

/// A root config read and checked, with its file.
///
/// Declared by the brief that ports `read-root-config.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum LoadedRootConfig {}

/// The config read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadRootConfigOutcome {
    /// The `config` member.
    Read(LoadedRootConfig),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

/// Reads the root config `file`, named `display_name` in problems.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn read_root_config(
    _file: &Utf8Path,
    _display_name: &str,
) -> Result<ReadRootConfigOutcome, CliConfigError> {
    Err(not_ported_yet("readRootConfig"))
}
