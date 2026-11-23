//! The published authoring schemas with the workspace's names listed at each name position.

use camino::{Utf8Path, Utf8PathBuf};
use seampact_authoring::AUTHORING_SCHEMA_FILES;
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue, indented_json};
use seampact_paths::RelativeOutputPath;

use crate::EditorSchemasError;
use crate::editor_names::EditorNames;
use crate::name_position::{NamePosition, NamePositionForm, name_positions};

// A schema reference also takes a file (`./schemas/task.yaml#/Task`), which the published
// pattern still checks.
const FILE_REFERENCE_PATTERN: &str = "^\\.\\.?/";
const SCHEMA_REFERENCE_TITLE: &str = "schema reference";

/// One editor schema file: its published name and its text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditorSchemaFile {
    /// `<kind>.schema.json`, the published file name, so relative `$ref`s and modelines keep
    /// working.
    pub file_name: String,
    /// The file text, two-space indented with a final newline.
    pub text: String,
}

impl EditorSchemaFile {
    /// The file's path below `directory`, once its name is checked as a relative path.
    ///
    /// # Errors
    ///
    /// [`EditorSchemasError::Io`] naming `directory` when the file name leaves it.
    pub fn path_in(&self, directory: &Utf8Path) -> Result<Utf8PathBuf, EditorSchemasError> {
        let relative = RelativeOutputPath::try_new(self.file_name.as_str()).map_err(|error| {
            EditorSchemasError::Io {
                path: directory.to_string(),
                message: error.to_string(),
            }
        })?;

        Ok(directory.join(relative.as_path()))
    }
}

/// The published authoring schemas, each name position listing the names `names` holds, one file
/// per authoring file in published order; the bytes depend on `names` only.
///
/// # Errors
///
/// [`EditorSchemasError::Internal`] when a published schema is not a JSON object or holds no
/// name at a listed position: `NAME_POSITIONS` is out of date.
pub fn editor_schema_files(
    names: &EditorNames,
) -> Result<Vec<EditorSchemaFile>, EditorSchemasError> {
    let mut copies = AUTHORING_SCHEMA_FILES
        .iter()
        .map(|file| {
            serde_json::from_str::<JsonValue>(file.text)
                .map(|schema| (file.kind, schema))
                .map_err(|error| {
                    InternalError::new(format!(
                        "the authoring schema {} is not JSON: {error}",
                        file.file_name
                    ))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;

    for position in name_positions() {
        let Some((_, schema)) = copies.iter_mut().find(|(kind, _)| *kind == position.file) else {
            return Err(InternalError::new(format!(
                "no authoring schema listing {}",
                position.file
            ))
            .into());
        };

        specialise(name_position_node(schema, &position)?, &position, names);
    }

    let files = AUTHORING_SCHEMA_FILES
        .iter()
        .zip(&copies)
        .map(|(file, (_, schema))| EditorSchemaFile {
            file_name: file.file_name.to_owned(),
            text: indented_json(schema),
        })
        .collect();

    Ok(files)
}

fn name_position_node<'schema>(
    schema: &'schema mut JsonValue,
    position: &NamePosition,
) -> Result<&'schema mut JsonObject, InternalError> {
    let mut node = Some(schema);

    for segment in position.pointer.split('/').skip(1) {
        let key = segment.replace("~1", "/").replace("~0", "~");

        node = match node {
            Some(JsonValue::Object(members)) => members.get_mut(&key),
            _ => None,
        };
    }

    match node {
        Some(JsonValue::Object(members)) if holds_name(members, position) => Ok(members),
        _ => Err(InternalError::new(format!(
            "the authoring schema {} holds no {} name at {}: update the name positions",
            position.file,
            position.catalogue.as_str(),
            position.pointer
        ))),
    }
}

fn holds_name(node: &JsonObject, position: &NamePosition) -> bool {
    let (member, expected) = match position.form {
        NamePositionForm::Reference => ("title", SCHEMA_REFERENCE_TITLE),
        NamePositionForm::Name { holds } | NamePositionForm::List { holds } => ("$ref", holds),
    };

    matches!(node.get(member), Some(JsonValue::String(text)) if text == expected)
}

fn specialise(node: &mut JsonObject, position: &NamePosition, names: &EditorNames) {
    let declared = names
        .get(&position.catalogue)
        .into_iter()
        .flatten()
        .map(|(name, description)| (name.as_str(), description.as_str()));
    let choices: Vec<(&str, &str)> = declared.chain(position.words.iter().copied()).collect();

    // An empty enum is refused by strict validators: the position keeps checking keywords only.
    if choices.is_empty() {
        return;
    }

    let mut listing = JsonObject::new();

    listing.insert(
        "enum".to_owned(),
        JsonValue::Array(
            choices
                .iter()
                .map(|(name, _)| JsonValue::String((*name).to_owned()))
                .collect(),
        ),
    );
    listing.insert(
        "enumDescriptions".to_owned(),
        JsonValue::Array(
            choices
                .iter()
                .map(|(_, description)| JsonValue::String((*description).to_owned()))
                .collect(),
        ),
    );

    match position.form {
        NamePositionForm::List { .. } => {
            node.insert("items".to_owned(), JsonValue::Object(listing));
        }
        NamePositionForm::Reference => {
            node.insert(
                "anyOf".to_owned(),
                JsonValue::Array(vec![JsonValue::Object(listing), file_reference()]),
            );
        }
        NamePositionForm::Name { .. } => {
            for (key, value) in &listing {
                node.insert(key.clone(), value.clone());
            }
        }
    }
}

fn file_reference() -> JsonValue {
    let mut reference = JsonObject::new();

    reference.insert(
        "pattern".to_owned(),
        JsonValue::String(FILE_REFERENCE_PATTERN.to_owned()),
    );

    JsonValue::Object(reference)
}
