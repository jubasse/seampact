//! The JSON values a document holds: optional members and numbers written as the TypeScript does.

use seampact_diagnostics::InternalError;
use seampact_json::{JsonNumber, JsonObject, JsonValue};

use crate::OpenApiError;

/// Sets `member` to `value` unless it is absent.
pub(crate) fn set_defined(target: &mut JsonObject, member: &str, value: Option<JsonValue>) {
    if let Some(defined) = value {
        target.insert(member.to_owned(), defined);
    }
}

/// A copy of an IR value, so a document never shares a value with the IR.
pub(crate) fn copy_optional(value: Option<&JsonValue>) -> Option<JsonValue> {
    value.cloned()
}

/// The JSON string of an optional text.
pub(crate) fn optional_text(text: Option<&str>) -> Option<JsonValue> {
    text.map(text_value)
}

/// The JSON string of a text.
pub(crate) fn text_value(text: &str) -> JsonValue {
    JsonValue::String(text.to_owned())
}

/// The JSON number of an IR integer, which the IR bounds below 2^53.
///
/// # Errors
///
/// [`OpenApiError::Internal`] for an integer no JSON number holds.
pub(crate) fn integer_value(value: i64) -> Result<JsonValue, OpenApiError> {
    JsonNumber::from_json_text(&value.to_string())
        .map(JsonValue::Number)
        .ok_or_else(|| InternalError::new(format!("the integer {value} is no JSON number")).into())
}

/// The JSON number of an optional IR integer.
///
/// # Errors
///
/// As [`integer_value`].
pub(crate) fn optional_integer(value: Option<i64>) -> Result<Option<JsonValue>, OpenApiError> {
    value.map(integer_value).transpose()
}
