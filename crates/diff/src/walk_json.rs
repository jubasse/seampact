//! JSON comparison and JSON Pointer helpers of the walk.

use seampact_diff_table::DiffValue;
use seampact_json::{JsonValue, canonical_json, escape_pointer};

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

/// `base` extended by the escaped segments (RFC 6901); an index is passed as its decimal text.
pub(crate) fn pointer_join(base: &str, segments: &[&str]) -> String {
    segments.iter().fold(base.to_owned(), |pointer, segment| {
        format!("{pointer}/{}", escape_pointer(segment))
    })
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
    fn a_pointer_segment_escapes_tilde_then_slash() {
        assert_eq!(pointer_join("", &["a/b", "c~d", "0"]), "/a~1b/c~0d/0");
        assert_eq!(pointer_join("/base", &[]), "/base");
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
}
