//! The reader a command compiles a contract directory through.

use camino::Utf8Path;
use seampact_load::FsReader;

use crate::GenerateError;

/// A reader over the disk below `directory`, the contract workspace root.
///
/// # Errors
///
/// [`GenerateError::Io`] when the directory cannot be resolved or is not UTF-8.
pub fn source_reader(directory: &Utf8Path) -> Result<FsReader, GenerateError> {
    FsReader::new(directory).map_err(|error| GenerateError::Io {
        path: directory.to_string(),
        message: error.to_string(),
    })
}
