//! Readers of the merged raw tree: they only narrow the JSON types, and a member the grammar
//! leaves optional reads as `None` when absent.

use seampact_json::{JsonObject, JsonValue};

/// The value as an object; `None` for another type or an absent value.
pub(crate) fn access_identity_is_object(value: Option<&JsonValue>) -> Option<&JsonObject> {
    match value {
        Some(JsonValue::Object(object)) => Some(object),
        _ => None,
    }
}

/// An own member of a raw mapping; `None` when absent.
pub(crate) fn access_identity_member<'raw>(
    object: &'raw JsonObject,
    key: &str,
) -> Option<&'raw JsonValue> {
    object.get(key)
}

/// A string member; `None` when absent or of another type.
pub(crate) fn access_identity_string<'raw>(
    object: &'raw JsonObject,
    key: &str,
) -> Option<&'raw str> {
    match access_identity_member(object, key) {
        Some(JsonValue::String(text)) => Some(text.as_str()),
        _ => None,
    }
}

/// A boolean member; `None` when absent or of another type.
pub(crate) fn access_identity_boolean(object: &JsonObject, key: &str) -> Option<bool> {
    match access_identity_member(object, key) {
        Some(JsonValue::Bool(flag)) => Some(*flag),
        _ => None,
    }
}

/// A list of strings, copied; `None` when absent or not a list.
pub(crate) fn access_identity_strings(object: &JsonObject, key: &str) -> Option<Vec<String>> {
    let Some(JsonValue::Array(items)) = access_identity_member(object, key) else {
        return None;
    };

    Some(
        items
            .iter()
            .filter_map(|item| match item {
                JsonValue::String(text) => Some(text.clone()),
                _ => None,
            })
            .collect(),
    )
}

/// A mapping member; `None` when absent or of another type.
pub(crate) fn access_identity_object<'raw>(
    object: &'raw JsonObject,
    key: &str,
) -> Option<&'raw JsonObject> {
    access_identity_is_object(access_identity_member(object, key))
}

/// The entries of a mapping member whose values are mappings, in written order.
pub(crate) fn access_identity_entries<'raw>(
    object: &'raw JsonObject,
    key: &str,
) -> Vec<(&'raw str, &'raw JsonObject)> {
    let Some(catalogue) = access_identity_object(object, key) else {
        return Vec::new();
    };

    catalogue
        .iter()
        .filter_map(|(name, value)| {
            access_identity_is_object(Some(value)).map(|entry| (name.as_str(), entry))
        })
        .collect()
}
