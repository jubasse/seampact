//! The checks on the paths a target generates: unsafe, duplicate and reserved paths.

use seampact_target::GeneratedFile;

use crate::not_ported::not_ported_yet;
use crate::{FilesOutcome, WriterError};

/// The file in each output directory that lists what the writer wrote there.
pub const MANIFEST_FILE_NAME: &str = ".seampact-manifest.json";

/// Refuses each unsafe, duplicate or reserved path, else answers the files in UTF-16 order of path.
///
/// # Errors
///
/// [`WriterError::NotPortedYet`] until the function is ported.
pub fn check_generated_paths(_files: &[GeneratedFile]) -> Result<FilesOutcome, WriterError> {
    Err(not_ported_yet("checkGeneratedPaths"))
}
