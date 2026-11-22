//! Reads of the untyped IR document, as the TypeScript reads it: an absent or mistyped member is
//! `None` or empty, never an error.

use seampact_js::js_number_of_text;
use seampact_json::{JsonObject, JsonValue, js_text_of, text_of};

/// Whether `String(value)` is one of `list`.
pub(super) fn is_listed(value: Option<&JsonValue>, list: &[&str]) -> bool {
    list.contains(&js_text_of(value).as_str())
}

/// The entry of `entries` a string key names, `None` for another key type or a missing key.
pub(super) fn entry<'entries>(
    entries: &'entries JsonObject,
    key: Option<&JsonValue>,
) -> Option<&'entries JsonValue> {
    entries.get(text_of(key)?)
}

/// `Number(value)`.
pub(super) fn js_number_of(value: &JsonValue) -> f64 {
    match value {
        JsonValue::Null => 0.0,
        JsonValue::Bool(flag) => f64::from(u8::from(*flag)),
        JsonValue::Number(number) => number.to_f64(),
        other => js_number_of_text(&js_text_of(Some(other))),
    }
}
