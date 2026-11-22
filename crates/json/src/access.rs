//! Reading a JSON value by its kind.

use crate::{JsonObject, JsonValue};

impl JsonValue {
    /// The members of this value when it is an object, as `isRecord`: not a list and not `null`.
    #[must_use]
    pub const fn as_object(&self) -> Option<&JsonObject> {
        match self {
            Self::Object(object) => Some(object),
            _ => None,
        }
    }

    /// The items of this value when it is an array.
    #[must_use]
    pub fn as_items(&self) -> Option<&[Self]> {
        match self {
            Self::Array(items) => Some(items),
            _ => None,
        }
    }

    /// The text of this value when it is a string.
    #[must_use]
    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::String(text) => Some(text),
            _ => None,
        }
    }
}

/// The members of `value` when it is an object.
#[must_use]
pub fn object_of(value: Option<&JsonValue>) -> Option<&JsonObject> {
    value.and_then(JsonValue::as_object)
}

/// The items of `value` when it is an array, empty for any other value.
#[must_use]
pub fn items_of(value: Option<&JsonValue>) -> &[JsonValue] {
    value.and_then(JsonValue::as_items).unwrap_or_default()
}

/// The text of `value` when it is a string.
#[must_use]
pub fn text_of(value: Option<&JsonValue>) -> Option<&str> {
    value.and_then(JsonValue::as_text)
}

/// Whether `value` is the string `expected`.
#[must_use]
pub fn is_text(value: Option<&JsonValue>, expected: &str) -> bool {
    text_of(value) == Some(expected)
}
