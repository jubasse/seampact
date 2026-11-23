//! Reads of a file that may be missing: a missing file is `None`, any other failure an error.

use std::fs::Metadata;

use camino::Utf8Path;

use crate::WriterError;
use crate::not_ported::not_ported_yet;

/// The text of `file`, `None` when there is no file there.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn read_file_if_present(_file: &Utf8Path) -> Result<Option<String>, WriterError> {
    Err(not_ported_yet("readFileIfPresent"))
}

/// The metadata of `file` without following a symbolic link, `None` when there is nothing there.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn lstat_if_present(_file: &Utf8Path) -> Result<Option<Metadata>, WriterError> {
    Err(not_ported_yet("lstatIfPresent"))
}
