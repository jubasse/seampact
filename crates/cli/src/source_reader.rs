//! The reader a command compiles a contract directory through.

use camino::Utf8Path;
use seampact_load::FsReader;

use crate::CliError;

/// A reader over the disk below `directory`, the contract workspace root.
///
/// # Errors
///
/// [`CliError::Io`] when the directory cannot be resolved or is not UTF-8.
pub(crate) fn source_reader(directory: &Utf8Path) -> Result<FsReader, CliError> {
    FsReader::new(directory).map_err(|error| CliError::Io {
        path: directory.to_string(),
        message: error.to_string(),
    })
}
