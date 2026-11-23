//! The installed version of a framework or library package, read from its `package.json` in the
//! `node_modules` directories from a lookup directory up, as Node's resolution searches them.

use camino::Utf8Path;

use crate::not_ported::not_ported_yet;
use crate::{CliConfigError, CliProblem};

/// A package found installed.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct InstalledVersion {
    /// The package name.
    pub package_name: String,
    /// The `version` of its `package.json`.
    pub version: String,
    /// The major of the version; a pre-release counts as its major.
    pub major: u64,
}

/// The installed version, or the problem that refuses it.
#[derive(Debug, Clone, PartialEq)]
pub enum InstalledVersionOutcome {
    /// The package is installed.
    Installed(InstalledVersion),
    /// The package is missing or its `package.json` cannot be read.
    Refused(CliProblem),
}

/// What the generated code imports the package as, which the problems name it by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InstalledPackageRole {
    /// The framework the target generates for.
    Framework,
    /// A library the switched-on artefacts import.
    Library,
    /// The validator library of a link.
    ValidatorLibrary,
}

/// Reads the installed version of `package_name` from `lookup_directory` up; `entry_where` names
/// the entry in a problem.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn read_installed_version(
    _lookup_directory: &Utf8Path,
    _package_name: &str,
    _role: InstalledPackageRole,
    _entry_where: &str,
) -> Result<InstalledVersionOutcome, CliConfigError> {
    Err(not_ported_yet("readInstalledVersion"))
}
