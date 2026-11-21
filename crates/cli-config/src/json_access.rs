//! Reading members of a config value that the schema already checked.

use seampact_json::{JsonObject, JsonValue};

/// The object of `value`, as `isRecord`: an object, not a list and not `null`.
pub(crate) fn record(value: Option<&JsonValue>) -> Option<&JsonObject> {
    match value {
        Some(JsonValue::Object(object)) => Some(object),
        _ => None,
    }
}

/// The text of `value`, when it is a string.
pub(crate) fn text(value: Option<&JsonValue>) -> Option<&str> {
    match value {
        Some(JsonValue::String(text)) => Some(text),
        _ => None,
    }
}

/// The items of `value`, empty when it is not a list.
pub(crate) fn items(value: Option<&JsonValue>) -> &[JsonValue] {
    match value {
        Some(JsonValue::Array(items)) => items,
        _ => &[],
    }
}
