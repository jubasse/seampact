//! Shared helpers of the finalize tests.

use seampact_json::JsonValue;
use serde_json::Value;

/// A `JsonValue` from a `serde_json::json!` value.
///
/// # Errors
///
/// A message when the value holds a number the JSON model refuses.
pub fn json(value: &Value) -> Result<JsonValue, String> {
    JsonValue::try_from(value.clone()).map_err(|error| error.to_string())
}

#[allow(dead_code, reason = "each test crate uses some of the helpers")]
/// The strings of the array at `member` of an object, for an order check.
#[must_use]
pub fn texts_at(value: &JsonValue, path: &[&str], member: &str) -> Vec<String> {
    let mut current = value;

    for step in path {
        current = match current {
            JsonValue::Object(object) => object.get(step),
            JsonValue::Array(_)
            | JsonValue::Null
            | JsonValue::Bool(_)
            | JsonValue::Number(_)
            | JsonValue::String(_) => None,
        }
        .unwrap_or(&JsonValue::Null);
    }

    let JsonValue::Array(items) = current else {
        return Vec::new();
    };

    items
        .iter()
        .map(|item| match item {
            JsonValue::Object(object) => match object.get(member) {
                Some(JsonValue::String(text)) => text.clone(),
                _ => String::new(),
            },
            JsonValue::String(text) => text.clone(),
            _ => String::new(),
        })
        .collect()
}
