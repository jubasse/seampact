//! The `openapi` key of an app config: the apis it documents and where each document goes.

use camino::{Utf8Path, Utf8PathBuf};
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_js::js_key_order;
use seampact_json::{JsonObject, JsonValue, object_of, text_of};

use crate::node_path::resolved_path;
use crate::read_root_config::document_options_of;

/// The text of `openapi: none`, the app writing no document.
const NO_OPENAPI_DOCUMENTS: &str = "none";

/// Where one document is written and the emitter options the config gives it.
#[derive(Debug, Clone, PartialEq)]
pub struct DocumentPlacement {
    /// The absolute file.
    pub file: Utf8PathBuf,
    /// The emitter options as the config writes them, an empty object when it writes none.
    pub options: JsonValue,
}

/// How the config places the documents of one api.
#[derive(Debug, Clone, PartialEq)]
pub enum ApiPlacements {
    /// A path, or an object with a `path`: the api's one document.
    One(DocumentPlacement),
    /// A mapping from document ids to their placements, in the order the TypeScript reads keys.
    ByDocument(IndexMap<String, DocumentPlacement>),
}

/// The apis an app's `openapi` documents with their placements, in the order the TypeScript
/// reads object keys; empty for `openapi: none`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct OpenApiSettings {
    /// The placements of each api the `openapi` mapping writes.
    pub apis: IndexMap<String, ApiPlacements>,
}

impl OpenApiSettings {
    /// The settings of an `openapi` value the config schema passed, its paths resolved against
    /// `directory`.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the value is neither `none` nor a mapping of placements.
    pub fn from_value(value: &JsonValue, directory: &Utf8Path) -> Result<Self, InternalError> {
        if text_of(Some(value)) == Some(NO_OPENAPI_DOCUMENTS) {
            return Ok(Self::default());
        }

        let object = object_of(Some(value)).ok_or_else(|| {
            InternalError::new(
                "an `openapi` that passed the schema is neither `none` nor a mapping",
            )
        })?;
        let apis = js_key_order(object.iter())
            .map(|(api, placements)| {
                Ok((
                    api.clone(),
                    ApiPlacements::from_value(placements, directory)?,
                ))
            })
            .collect::<Result<_, InternalError>>()?;

        Ok(Self { apis })
    }
}

impl ApiPlacements {
    /// A placement is one when it is a path or an object with a `path`; else it maps document ids.
    fn from_value(placements: &JsonValue, directory: &Utf8Path) -> Result<Self, InternalError> {
        if is_one_placement(placements) {
            return Ok(Self::One(DocumentPlacement::from_value(
                placements, directory,
            )?));
        }

        let object = object_of(Some(placements)).ok_or_else(|| {
            InternalError::new("a document placement that passed the schema is not a mapping")
        })?;
        let documents = js_key_order(object.iter())
            .map(|(document, placement)| {
                Ok((
                    document.clone(),
                    DocumentPlacement::from_value(placement, directory)?,
                ))
            })
            .collect::<Result<_, InternalError>>()?;

        Ok(Self::ByDocument(documents))
    }
}

impl DocumentPlacement {
    fn from_value(placement: &JsonValue, directory: &Utf8Path) -> Result<Self, InternalError> {
        if let JsonValue::String(path) = placement {
            return Ok(Self {
                file: resolved_path(directory, path),
                options: empty_options(),
            });
        }

        let object = object_of(Some(placement));
        let path = text_of(object.and_then(|object| object.get("path"))).ok_or_else(|| {
            InternalError::new("a document placement that passed the schema has no path")
        })?;

        Ok(Self {
            file: resolved_path(directory, path),
            options: object.map_or_else(empty_options, document_options_of),
        })
    }
}

fn is_one_placement(placements: &JsonValue) -> bool {
    matches!(placements, JsonValue::String(_))
        || text_of(object_of(Some(placements)).and_then(|object| object.get("path"))).is_some()
}

/// The options of a document the config gives none.
pub(crate) fn empty_options() -> JsonValue {
    JsonValue::Object(JsonObject::new())
}
