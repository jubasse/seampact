//! JSON comparison and JSON Pointer helpers of the walk.

use seampact_diagnostics::InternalError;
use seampact_diff_table::DiffValue;
use seampact_ir::to_json_value;
use seampact_js::cmp_utf16;
use seampact_json::{JsonObject, JsonValue, canonical_json};
use serde::Serialize;

use crate::DiffError;

/// Whether two values are the same JSON, object member order aside; two absent values are.
pub(crate) fn is_same_json(left: Option<&JsonValue>, right: Option<&JsonValue>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left_value), Some(right_value)) => {
            canonical_json(left_value) == canonical_json(right_value)
        }
        (None, Some(_)) | (Some(_), None) => false,
    }
}

/// The sorted union of the member names of two objects, in UTF-16 code unit order.
pub(crate) fn member_names<'members>(
    before: Option<&'members JsonObject>,
    after: Option<&'members JsonObject>,
) -> Vec<&'members str> {
    let mut names: Vec<&str> = before
        .into_iter()
        .chain(after)
        .flat_map(|members| members.keys().map(String::as_str))
        .collect();

    names.sort_by(|left, right| cmp_utf16(left, right));
    names.dedup();

    names
}

/// The JSON of an IR value, as the TypeScript walk reads it.
pub(crate) fn json_of<T: Serialize>(value: &T) -> Result<JsonValue, DiffError> {
    Ok(to_json_value(value).map_err(|error| InternalError::new(error.to_string()))?)
}

/// The members of an IR object as JSON.
pub(crate) fn object_members<T: Serialize>(value: &T) -> Result<JsonObject, DiffError> {
    match json_of(value)? {
        JsonValue::Object(members) => Ok(members),
        other => Err(InternalError::new(format!("{other:?} encodes as no object")).into()),
    }
}

/// A text as a change value.
pub(crate) fn text_value(text: &str) -> JsonValue {
    JsonValue::String(text.to_owned())
}

/// A flag as a change value.
pub(crate) fn flag_value(flag: bool) -> JsonValue {
    JsonValue::Bool(flag)
}

/// The value as a report value when it is a scalar, else `None`.
pub(crate) fn scalar_value(value: Option<&JsonValue>) -> Option<DiffValue> {
    match value? {
        JsonValue::Null => Some(DiffValue::Null),
        JsonValue::Bool(flag) => Some(DiffValue::Bool(*flag)),
        JsonValue::Number(number) => Some(DiffValue::Number(number.clone())),
        JsonValue::String(text) => Some(DiffValue::Text(text.clone())),
        JsonValue::Array(_) | JsonValue::Object(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use seampact_json::JsonObject;

    use super::*;

    fn object(members: &[(&str, i64)]) -> JsonValue {
        let mut object = JsonObject::new();

        for (name, number) in members {
            object.insert(
                (*name).to_owned(),
                JsonValue::Number(seampact_json::JsonNumber::from_i64(*number)),
            );
        }

        JsonValue::Object(object)
    }

    #[test]
    fn two_objects_in_another_member_order_are_the_same_json() {
        let left = object(&[("a", 1), ("b", 2)]);
        let right = object(&[("b", 2), ("a", 1)]);

        assert!(is_same_json(Some(&left), Some(&right)));
        assert!(!is_same_json(Some(&left), None));
        assert!(is_same_json(None, None));
    }

    #[test]
    fn only_a_scalar_is_a_report_value() {
        assert_eq!(scalar_value(Some(&JsonValue::Null)), Some(DiffValue::Null));
        assert_eq!(
            scalar_value(Some(&JsonValue::Bool(false))),
            Some(DiffValue::Bool(false))
        );
        assert_eq!(scalar_value(Some(&object(&[]))), None);
        assert_eq!(scalar_value(Some(&JsonValue::Array(Vec::new()))), None);
        assert_eq!(scalar_value(None), None);
    }

    #[test]
    fn member_names_are_the_utf16_sorted_union() {
        let before = object(&[("\u{FF5E}", 1), ("b", 1)]);
        let after = object(&[("\u{10000}", 1), ("b", 1)]);
        let (JsonValue::Object(before_members), JsonValue::Object(after_members)) =
            (&before, &after)
        else {
            panic!("not objects");
        };

        assert_eq!(
            member_names(Some(before_members), Some(after_members)),
            vec!["b", "\u{10000}", "\u{FF5E}"]
        );
        assert_eq!(member_names(None, None), Vec::<&str>::new());
    }
}
