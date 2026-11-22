//! The check of where `compile --editor-schemas` writes: inside the workspace root, by real path,
//! with no symbolic link in the way.

use std::fs;
use std::io::ErrorKind;

use camino::{Utf8Path, Utf8PathBuf};
use seampact_cli_config::{CliProblem, is_strictly_inside, is_symbolic_link, resolved_path};
use seampact_load::{LoadOptions, LoadReader, load_workspace};

use crate::EditorSchemasError;
use crate::editor_names::{EditorDeclaration, editor_names};
use crate::specialise::editor_schema_files;
use crate::write_editor_schemas::{EditorSchemasPlan, io_error};

/// Where `compile --editor-schemas` writes when `workspace.editorSchemas` names nothing.
pub const DEFAULT_EDITOR_SCHEMAS_DIRECTORY: &str = ".seampact/schemas";

const OUTSIDE_CODE: &str = "compile.editor-schemas.outside";

/// What a plan reads: the workspace and what its apis declare.
pub struct EditorSchemasSource<'run> {
    /// The name of the source, for a problem's location.
    pub name: &'run str,
    /// The contract workspace's root, absolute.
    pub directory: &'run Utf8Path,
    /// Root-relative entry file: `workspace.yaml`, or the single api file.
    pub entry: &'run str,
    /// How the loader reaches the workspace's files.
    pub reader: &'run dyn LoadReader,
    /// What every api of the workspace declares.
    pub declarations: &'run [EditorDeclaration],
}

/// A plan, or the refusal that says why nothing is written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditorSchemasPlanOutcome {
    /// A checked write.
    Planned(EditorSchemasPlan),
    /// The directory is outside the workspace root or a target is a symbolic link.
    Refused(CliProblem),
}

/// Checks where the workspace's editor schemas go (`workspace.editorSchemas`, under its root) and
/// writes nothing.
///
/// # Errors
///
/// [`EditorSchemasError::Internal`] on a bug, [`EditorSchemasError::Io`] when the file system
/// refuses a check, [`EditorSchemasError::Config`] when a symbolic link check fails.
pub fn plan_editor_schemas(
    source: &EditorSchemasSource<'_>,
) -> Result<EditorSchemasPlanOutcome, EditorSchemasError> {
    let loaded = load_workspace(&LoadOptions {
        reader: source.reader,
        entry: source.entry,
    })?;
    let configured = loaded
        .workspace
        .config
        .as_ref()
        .and_then(|config| config.editor_schemas.as_deref())
        .unwrap_or(DEFAULT_EDITOR_SCHEMAS_DIRECTORY);
    let directory = resolved_path(source.directory, configured);
    let root = resolved_path(source.directory, ".");

    if Utf8Path::new(configured).is_absolute() || !is_strictly_inside(&root, &directory) {
        return Ok(refused(
            source,
            format!(
                "workspace.editorSchemas names '{configured}', which is not a directory inside the workspace root {}.",
                source.directory
            ),
        ));
    }

    let real_root = real_path(source.directory)?.ok_or_else(|| EditorSchemasError::Io {
        path: source.directory.to_string(),
        message: "the workspace root does not exist".to_owned(),
    })?;
    let inside_by_real_path = match real_target_directory(&directory)? {
        Some(real) => is_strictly_inside(&real_root, &real),
        None => false,
    };

    if !inside_by_real_path {
        return Ok(refused(
            source,
            format!(
                "workspace.editorSchemas names '{configured}', which resolves through a symbolic link to a place outside the workspace root {}.",
                source.directory
            ),
        ));
    }

    let files = editor_schema_files(&editor_names(source.declarations))?;

    for file in &files {
        let target = directory.join(&file.file_name);

        if is_symbolic_link(&target)? {
            return Ok(refused(
                source,
                format!(
                    "The editor schema {target} is a symbolic link, and writing it would overwrite its target."
                ),
            ));
        }
    }

    Ok(EditorSchemasPlanOutcome::Planned(EditorSchemasPlan {
        directory,
        files,
    }))
}

// The real path of `directory`, with the part that does not exist yet appended unchanged; `None`
// when a symbolic link on the way leads nowhere.
fn real_target_directory(directory: &Utf8Path) -> Result<Option<Utf8PathBuf>, EditorSchemasError> {
    let mut missing: Vec<&str> = Vec::new();
    let mut existing = directory;

    loop {
        if let Some(mut real) = real_path(existing)? {
            real.extend(missing.iter().rev());

            return Ok(Some(real));
        }

        if is_symbolic_link(existing)? {
            return Ok(None);
        }

        let (Some(parent), Some(name)) = (existing.parent(), existing.file_name()) else {
            return Ok(None);
        };

        missing.push(name);
        existing = parent;
    }
}

// `None` when nothing is at `path`, a dangling symbolic link included.
fn real_path(path: &Utf8Path) -> Result<Option<Utf8PathBuf>, EditorSchemasError> {
    match fs::canonicalize(path) {
        Ok(real) => {
            Utf8PathBuf::from_path_buf(real)
                .map(Some)
                .map_err(|real| EditorSchemasError::Io {
                    path: path.to_string(),
                    message: format!("the real path {} is not UTF-8", real.display()),
                })
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(path, &error)),
    }
}

fn refused(source: &EditorSchemasSource<'_>, message: String) -> EditorSchemasPlanOutcome {
    EditorSchemasPlanOutcome::Refused(CliProblem {
        code: OUTSIDE_CODE.to_owned(),
        message,
        fix: format!(
            "Name a relative directory below the workspace root with no symbolic link in it, such as {DEFAULT_EDITOR_SCHEMAS_DIRECTORY}, or remove workspace.editorSchemas."
        ),
        location: Some(format!("source '{}', {}", source.name, source.entry)),
        position: None,
        docs: None,
    })
}
