//! A JSON object read without its type.

use seampact_json::{JsonObject, JsonValue};

/// The object of `value`, or `None` for null, an array or a scalar: the TypeScript `finalizeIsRecord`.
pub(crate) fn finalize_is_record(value: &JsonValue) -> Option<&JsonObject> {
    match value {
        JsonValue::Object(object) => Some(object),
        JsonValue::Null
        | JsonValue::Bool(_)
        | JsonValue::Number(_)
        | JsonValue::String(_)
        | JsonValue::Array(_) => None,
    }
}
