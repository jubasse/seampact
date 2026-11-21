//! The schema files of `compile --editor-schemas`.

use camino::Utf8PathBuf;

use crate::EditorSchemasError;
use crate::not_ported::not_ported_yet;

/// One editor schema file: its name and its text.
///
/// Declared by the brief that ports `write-editor-schemas.ts`; uninhabited until then.
#[derive(Debug, Clone, PartialEq)]
pub enum EditorSchemaFile {}

/// The schema files to write and their directory.
#[derive(Debug, Clone, PartialEq)]
pub struct EditorSchemasPlan {
    /// The `directory` member.
    pub directory: Utf8PathBuf,
    /// The `files` member.
    pub files: Vec<EditorSchemaFile>,
}

/// Writes every file of `plan`, each through a temporary file; answers how many were written.
///
/// # Errors
///
/// [`EditorSchemasError::NotPortedYet`] until the function is ported.
pub fn write_editor_schemas(_plan: &EditorSchemasPlan) -> Result<usize, EditorSchemasError> {
    Err(not_ported_yet("writeEditorSchemas"))
}
