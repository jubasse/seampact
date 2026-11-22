//! The JSON values a document holds: optional members and numbers written as the TypeScript does.

use seampact_json::{JsonNumber, JsonObject, JsonValue};

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
    text.map(JsonValue::text)
}

/// The object member `member` of `object`, or `None` when it is absent or not an object.
pub(crate) fn object_member<'object>(
    object: &'object JsonObject,
    member: &str,
) -> Option<&'object JsonObject> {
    match object.get(member) {
        Some(JsonValue::Object(found)) => Some(found),
        _ => None,
    }
}

/// The items of the array member `member` of `object`, none when it is absent or not an array.
pub(crate) fn array_member<'object>(
    object: &'object JsonObject,
    member: &str,
) -> &'object [JsonValue] {
    match object.get(member) {
        Some(JsonValue::Array(items)) => items,
        _ => &[],
    }
}

/// The JSON number of an IR integer.
pub(crate) fn integer_value(value: i64) -> JsonValue {
    JsonValue::Number(JsonNumber::from_i64(value))
}

/// The JSON number of an optional IR integer.
pub(crate) fn optional_integer(value: Option<i64>) -> Option<JsonValue> {
    value.map(integer_value)
}
