//! The package manager of a project, found by its lockfile, and the install command it takes.

use camino::Utf8Path;

use crate::CliConfigError;
use crate::not_ported::not_ported_yet;

/// A package manager a lockfile names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PackageManager {
    /// `pnpm-lock.yaml`.
    Pnpm,
    /// `package-lock.json`, and the default without a lockfile.
    Npm,
    /// `yarn.lock`.
    Yarn,
    /// `bun.lock` or `bun.lockb`.
    Bun,
}

/// Where an installed package goes in `package.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DependencyKind {
    /// `devDependencies`.
    Dev,
    /// `dependencies`.
    Runtime,
}

/// The command that installs `package_name` in the project of `directory`.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn install_command(
    _directory: &Utf8Path,
    _package_name: &str,
    _kind: DependencyKind,
) -> Result<String, CliConfigError> {
    Err(not_ported_yet("installCommand"))
}

/// The fix of a problem whose package is missing: the install command, or a generic sentence when
/// a `package.json` on the way cannot be parsed.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn install_fix(
    _directory: &Utf8Path,
    _package_name: &str,
    _kind: DependencyKind,
) -> Result<String, CliConfigError> {
    Err(not_ported_yet("installFix"))
}

/// The package manager of the nearest directory from `directory` up that holds a lockfile.
///
/// # Errors
///
/// [`CliConfigError::NotPortedYet`] until the function is ported.
pub fn find_package_manager(_directory: &Utf8Path) -> Result<PackageManager, CliConfigError> {
    Err(not_ported_yet("findPackageManager"))
}
