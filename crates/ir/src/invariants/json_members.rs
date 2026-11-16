//! Reads of the untyped IR document, as the TypeScript reads it: an absent or mistyped member is
//! `None` or empty, never an error.

use seampact_js::js_number_of_text;
use seampact_json::{JsonObject, JsonValue, js_text_of};

/// The object a value is, if it is one.
pub(super) fn record(value: Option<&JsonValue>) -> Option<&JsonObject> {
    match value {
        Some(JsonValue::Object(object)) => Some(object),
        _ => None,
    }
}

/// The items of an array value, empty for anything else.
pub(super) fn items(value: Option<&JsonValue>) -> &[JsonValue] {
    match value {
        Some(JsonValue::Array(items)) => items,
        _ => &[],
    }
}

/// The text of a string value.
pub(super) fn string(value: Option<&JsonValue>) -> Option<&str> {
    match value {
        Some(JsonValue::String(text)) => Some(text),
        _ => None,
    }
}

/// Whether the value is the string `text`.
pub(super) fn is_string(value: Option<&JsonValue>, text: &str) -> bool {
    string(value) == Some(text)
}

/// `String(value)`.
pub(super) fn text_of(value: Option<&JsonValue>) -> String {
    js_text_of(value)
}

/// Whether `String(value)` is one of `list`.
pub(super) fn is_listed(value: Option<&JsonValue>, list: &[&str]) -> bool {
    list.contains(&text_of(value).as_str())
}

/// The entry of `entries` a string key names, `None` for another key type or a missing key.
pub(super) fn entry<'entries>(
    entries: &'entries JsonObject,
    key: Option<&JsonValue>,
) -> Option<&'entries JsonValue> {
    entries.get(string(key)?)
}

/// `Number(value)`.
pub(super) fn js_number_of(value: &JsonValue) -> f64 {
    match value {
        JsonValue::Null => 0.0,
        JsonValue::Bool(flag) => f64::from(u8::from(*flag)),
        JsonValue::Number(number) => number.to_f64(),
        other => js_number_of_text(&text_of(Some(other))),
    }
}
