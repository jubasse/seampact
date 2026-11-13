//! The embedded authoring schema files, parsed once, for the readers that take their patterns and
//! leaves from the grammar.

use std::collections::HashMap;
use std::sync::LazyLock;

use seampact_authoring::AUTHORING_SCHEMA_FILES;
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue};

static SCHEMAS: LazyLock<Result<HashMap<&'static str, JsonObject>, String>> =
    LazyLock::new(parse_schemas);

fn parse_schemas() -> Result<HashMap<&'static str, JsonObject>, String> {
    let mut schemas = HashMap::new();

    for file in AUTHORING_SCHEMA_FILES {
        let parsed: JsonValue = serde_json::from_str(file.text).map_err(|error| {
            format!(
                "the embedded schema {} is not JSON: {error}",
                file.file_name
            )
        })?;
        let JsonValue::Object(object) = parsed else {
            return Err(format!(
                "the embedded schema {} is not an object",
                file.file_name
            ));
        };

        schemas.insert(file.kind, object);
    }

    Ok(schemas)
}

/// The authoring schema file of `kind` (`conventions`, `common`), as a JSON object.
///
/// # Errors
///
/// An [`InternalError`] when the embedded bundle is broken or has no file of that kind.
pub(super) fn authoring_schema(kind: &str) -> Result<&'static JsonObject, InternalError> {
    let schemas = SCHEMAS
        .as_ref()
        .map_err(|what| InternalError::new(what.clone()))?;

    schemas
        .get(kind)
        .ok_or_else(|| InternalError::new(format!("the authoring grammar has no {kind} schema")))
}
