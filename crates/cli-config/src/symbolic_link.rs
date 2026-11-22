//! Whether a path is a symbolic link, the check before a write that would follow it.

use std::fs;
use std::io::ErrorKind;

use camino::Utf8Path;

use crate::CliConfigError;
use crate::config_file::io_error;

/// Whether `path` is a symbolic link, dangling or not; `false` when nothing is there.
///
/// # Errors
///
/// [`CliConfigError::Io`] when the system refuses the check for another reason than a missing
/// path.
pub fn is_symbolic_link(path: &Utf8Path) -> Result<bool, CliConfigError> {
    match fs::symlink_metadata(path) {
        Ok(stats) => Ok(stats.is_symlink()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(io_error(path, &error)),
    }
}
