//! Whether a path is a symbolic link, the check before a write that would follow it.

use camino::Utf8Path;
use seampact_paths::{is_symbolic_link as is_link_on_disk, lstat_if_present};

use crate::CliConfigError;
use crate::config_file::io_error;

/// Whether `path` is a symbolic link, dangling or not; `false` when nothing is there.
///
/// # Errors
///
/// [`CliConfigError::Io`] when the system refuses the check for another reason than a missing
/// path.
pub fn is_symbolic_link(path: &Utf8Path) -> Result<bool, CliConfigError> {
    is_link_on_disk(path).map_err(|error| io_error(path, &error))
}

/// Whether anything is at `path`, a dangling symbolic link included.
///
/// # Errors
///
/// [`CliConfigError::Io`] when the system refuses the check for another reason than a missing
/// path.
pub fn is_path_taken(path: &Utf8Path) -> Result<bool, CliConfigError> {
    lstat_if_present(path)
        .map(|metadata| metadata.is_some())
        .map_err(|error| io_error(path, &error))
}
