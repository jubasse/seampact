//! The app config of a project.

use camino::Utf8Path;

use crate::not_ported::not_ported_yet;
use crate::{CliConfigError, CliProblem};

/// An app config read and checked, with its file.
///
/// Declared by the brief that ports `read-app-config.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum LoadedAppConfig {}

/// The config read, or the problems that stop it.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadAppConfigOutcome {
    /// The `config` member.
    Read(LoadedAppConfig),
    /// The `problems` member.
    Refused(Vec<CliProblem>),
}

/// Reads the app config `file`, named `display_name` in problems; `text_file` holds its text when it differs.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn read_app_config(
    _file: &Utf8Path,
    _display_name: &str,
    _text_file: Option<&Utf8Path>,
) -> Result<ReadAppConfigOutcome, CliConfigError> {
    Err(not_ported_yet("readAppConfig"))
}
