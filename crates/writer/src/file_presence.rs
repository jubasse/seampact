//! Reads of a file that may be missing: a missing file is `None`, any other failure an error.

use std::fs::{self, Metadata};
use std::io::ErrorKind;

use camino::Utf8Path;

use crate::WriterError;

/// The text of `file`, `None` when there is no file there; bytes that are not UTF-8 read as
/// U+FFFD, as Node's `readFile` does.
///
/// # Errors
///
/// [`WriterError::Io`] for any failure but a missing file.
pub fn read_file_if_present(file: &Utf8Path) -> Result<Option<String>, WriterError> {
    match fs::read(file) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(WriterError::io(file, &error)),
    }
}

/// The metadata of `file` without following a symbolic link, `None` when there is nothing there.
///
/// # Errors
///
/// [`WriterError::Io`] for any failure but a missing file.
pub fn lstat_if_present(file: &Utf8Path) -> Result<Option<Metadata>, WriterError> {
    match fs::symlink_metadata(file) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(WriterError::io(file, &error)),
    }
}
