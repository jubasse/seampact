//! The root config of a monorepo and the app configs it names.

use camino::Utf8Path;

use crate::not_ported::not_ported_yet;
use crate::{CliConfigError, CliProblem};

/// A root config and every app config it names, read and checked.
///
/// Declared by the brief that ports `read-workspace-configs.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum LoadedWorkspace {}

/// The workspace read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadWorkspaceOutcome {
    /// The `workspace` member.
    Read(LoadedWorkspace),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

/// Reads the root config `root_file` and every app config it names.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn read_workspace_configs(
    _root_file: &Utf8Path,
    _display_name: &str,
) -> Result<ReadWorkspaceOutcome, CliConfigError> {
    Err(not_ported_yet("readWorkspaceConfigs"))
}
