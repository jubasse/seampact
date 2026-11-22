//! The schema files of `compile --editor-schemas`, written through temporary files.

use std::fs;
use std::io;

use camino::{Utf8Path, Utf8PathBuf};

use crate::EditorSchemasError;
use crate::specialise::EditorSchemaFile;

const TEMPORARY_SUFFIX: &str = ".tmp";

/// A checked write: the directory is inside the workspace root by real path, and no target file
/// is a symlink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditorSchemasPlan {
    /// The directory the files go in.
    pub directory: Utf8PathBuf,
    /// The files, in published order.
    pub files: Vec<EditorSchemaFile>,
}

/// Writes every file of `plan`, each through a temporary file; answers how many were written.
///
/// # Errors
///
/// [`EditorSchemasError::Io`] naming the path the system refused.
pub fn write_editor_schemas(plan: &EditorSchemasPlan) -> Result<usize, EditorSchemasError> {
    fs::create_dir_all(&plan.directory).map_err(|error| io_error(&plan.directory, &error))?;

    for file in &plan.files {
        let target = plan.directory.join(&file.file_name);
        let temporary = Utf8PathBuf::from(format!("{target}{TEMPORARY_SUFFIX}"));

        fs::write(&temporary, &file.text).map_err(|error| io_error(&temporary, &error))?;
        fs::rename(&temporary, &target).map_err(|error| io_error(&target, &error))?;
    }

    Ok(plan.files.len())
}

pub(crate) fn io_error(path: &Utf8Path, error: &io::Error) -> EditorSchemasError {
    EditorSchemasError::Io {
        path: path.to_string(),
        message: error.to_string(),
    }
}
