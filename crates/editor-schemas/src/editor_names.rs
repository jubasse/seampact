//! The catalogue entries an api declares, located, for the editor schemas.

use seampact_compiler::PipelineApiResult;

use crate::EditorSchemasError;
use crate::not_ported::not_ported_yet;

/// One catalogue entry an api declares, with where it is declared.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EditorDeclaration {
    /// The `catalogue` member.
    pub catalogue: String,
    /// The `name` member.
    pub name: String,
    /// The file the entry is declared in.
    pub file: String,
    /// The line the entry is declared at.
    pub line: u32,
}

/// The declarations of `api`, from its declared entries and its side table.
///
/// # Errors
///
/// [`EditorSchemasError::NotPortedYet`] until the function is ported.
pub fn editor_declarations(
    _api: &PipelineApiResult,
) -> Result<Vec<EditorDeclaration>, EditorSchemasError> {
    Err(not_ported_yet("editorDeclarations"))
}
