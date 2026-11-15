//! `String(value)` of a JSON value, as a message writes it.

use seampact_js::FiniteNumber;
use seampact_json::JsonValue;

/// `String(value)` of a value read from JSON, or of an absent one.
pub(crate) fn js_text_of(value: Option<&JsonValue>) -> String {
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
        Some(JsonValue::Array(items)) => items
            .iter()
            .map(|item| match item {
                JsonValue::Null => String::new(),
                other => js_text_of(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(JsonValue::Object(_)) => "[object Object]".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_and_arrays_read_like_javascript() {
        let list = JsonValue::Array(vec![JsonValue::Null, JsonValue::String("a".to_owned())]);

        assert_eq!(js_text_of(Some(&list)), ",a");
        assert_eq!(js_text_of(None), "undefined");
    }
}
