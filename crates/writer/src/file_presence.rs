//! Reads of a file that may be missing: a missing file is `None`, any other failure an error.

use std::fs::{self, Metadata};
use std::io::{self, ErrorKind, Read};

use camino::Utf8Path;
use seampact_paths::lstat_if_present;

use crate::WriterError;

const NOT_A_REGULAR_FILE: &str = "it is not a regular file";

/// The text of `file`, `None` when there is no file there; bytes that are not UTF-8 read as
/// U+FFFD, as Node's `readFile` does. A symbolic link or any entry that is not a regular file is
/// refused, never followed or opened.
///
/// # Errors
///
/// [`WriterError::Io`] for an entry that is not a regular file, and for any failure but a missing
/// file.
pub fn read_file_if_present(file: &Utf8Path) -> Result<Option<String>, WriterError> {
    let Some(metadata) = lstat_entry(file)? else {
        return Ok(None);
    };

    if !metadata.is_file() {
        return Err(WriterError::io(file, &io::Error::other(NOT_A_REGULAR_FILE)));
    }

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
pub(crate) fn lstat_entry(file: &Utf8Path) -> Result<Option<Metadata>, WriterError> {
    lstat_if_present(file).map_err(|error| WriterError::io(file, &error))
}

/// What [`read_regular_file_capped`] found at a path that holds something.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CappedRead {
    /// The text of a regular file within the cap.
    Text(String),
    /// A symbolic link, a directory or another entry that is not a regular file; never opened.
    NotRegularFile,
    /// A regular file above the cap; never read whole.
    TooLarge,
}

/// Like [`read_file_if_present`], but a link or any entry that is not a regular file is not
/// followed or opened, and a file above `max_bytes` is not read whole.
///
/// # Errors
///
/// [`WriterError::Io`] for any failure but a missing file.
pub fn read_regular_file_capped(
    file: &Utf8Path,
    max_bytes: u64,
) -> Result<Option<CappedRead>, WriterError> {
    let Some(metadata) = lstat_entry(file)? else {
        return Ok(None);
    };

    if !metadata.is_file() {
        return Ok(Some(CappedRead::NotRegularFile));
    }

    if metadata.len() > max_bytes {
        return Ok(Some(CappedRead::TooLarge));
    }

    let opened = fs::File::open(file).map_err(|error| WriterError::io(file, &error))?;
    let mut bytes = Vec::new();

    // One byte past the cap catches a file that grew after the lstat.
    opened
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|error| WriterError::io(file, &error))?;

    if u64::try_from(bytes.len()).is_ok_and(|length| length > max_bytes) {
        return Ok(Some(CappedRead::TooLarge));
    }

    Ok(Some(CappedRead::Text(
        String::from_utf8_lossy(&bytes).into_owned(),
    )))
}
