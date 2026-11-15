//! `String(value)` of a JSON value, as a message writes it.

use seampact_js::FiniteNumber;

use crate::JsonValue;

/// `String(value)` of a value read from JSON, or of an absent one (`undefined`).
///
/// An array joins its items with `,`, a `null` item written empty, as `Array.prototype.join`
/// does; an object is `[object Object]`.
#[must_use]
pub fn js_text_of(value: Option<&JsonValue>) -> String {
    match value {
        None => "undefined".to_owned(),
        Some(JsonValue::Null) => "null".to_owned(),
        Some(JsonValue::Bool(flag)) => flag.to_string(),
        Some(JsonValue::Number(number)) => match FiniteNumber::new(number.to_f64()) {
            Some(finite) => finite.to_string(),
            None if number.to_f64() < 0.0 => "-Infinity".to_owned(),
            None => "Infinity".to_owned(),
        },
        Some(JsonValue::String(text)) => text.clone(),
        Some(JsonValue::Array(items)) => {
            let texts: Vec<String> = items
                .iter()
                .map(|item| match item {
                    JsonValue::Null => String::new(),
                    other => js_text_of(Some(other)),
                })
                .collect();

            texts.join(",")
        }
        Some(JsonValue::Object(_)) => "[object Object]".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of_json(text: &str) -> String {
        let value: JsonValue = serde_json::from_str(text).unwrap();

        js_text_of(Some(&value))
    }

    #[test]
    fn absent_null_and_booleans_read_like_javascript() {
        assert_eq!(js_text_of(None), "undefined");
        assert_eq!(text_of_json("null"), "null");
        assert_eq!(text_of_json("true"), "true");
    }

    #[test]
    fn numbers_are_written_as_ecmascript_number_text() {
        for (input, expected) in [
            ("-0", "0"),
            ("0.1", "0.1"),
            ("1e21", "1e+21"),
            ("1e-7", "1e-7"),
            ("123456789012345680000", "123456789012345680000"),
        ] {
            assert_eq!(text_of_json(input), expected, "input {input:?}");
        }
    }

    #[test]
    fn arrays_join_their_items_and_write_a_null_item_empty() {
        assert_eq!(
            text_of_json(r#"[null, "a", [1, [2, null]], true]"#),
            ",a,1,2,,true"
        );
        assert_eq!(text_of_json("[]"), "");
    }

    #[test]
    fn strings_are_kept_and_objects_are_their_tag() {
        assert_eq!(text_of_json(r#""😀 x""#), "\u{1F600} x");
        assert_eq!(text_of_json(r#"{"a": 1}"#), "[object Object]");
    }
}
