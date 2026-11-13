//! The authored-key defences of the trees the loader builds.
//!
//! The trees hold keys an author wrote. The three names that reach a JavaScript object's
//! prototype are refused before they become keys (`seampact/load/reserved-key`), as they are in
//! the diagnostics the fixtures hold. The rest of the TypeScript defences (a prototype-less object,
//! own-property reads, defined keys, the deep copy) are what [`JsonObject`] and `Clone` already
//! do.

use seampact_js::FiniteNumber;
use seampact_json::{JsonNumber, JsonObject, JsonValue, write_json_string};

/// Keys refused wherever an author writes one (`seampact/load/reserved-key`).
pub const RESERVED_KEYS: [&str; 3] = ["__proto__", "constructor", "prototype"];

/// Whether `key` is one of the [`RESERVED_KEYS`].
#[must_use]
pub fn is_reserved_key(key: &str) -> bool {
    RESERVED_KEYS.contains(&key)
}

/// For messages: a value as its author would recognise it, whatever its type; a string as it is,
/// any other value as `JSON.stringify` writes it, an absent value as `nothing`.
#[must_use]
pub fn show_value(value: Option<&JsonValue>) -> String {
    match value {
        None => "nothing".to_owned(),
        Some(JsonValue::String(text)) => text.clone(),
        Some(other) => json_stringify(other),
    }
}

/// `JSON.stringify(value)`: compact, members in the object's own order, numbers as JavaScript
/// writes them.
#[must_use]
pub(crate) fn json_stringify(value: &JsonValue) -> String {
    let mut written = String::new();

    write_compact(&mut written, value);

    written
}

fn write_compact(output: &mut String, value: &JsonValue) {
    match value {
        JsonValue::Null => output.push_str("null"),
        JsonValue::Bool(flag) => output.push_str(if *flag { "true" } else { "false" }),
        JsonValue::Number(number) => output.push_str(&number_text(number)),
        JsonValue::String(text) => write_json_string(output, text),
        JsonValue::Array(items) => write_compact_array(output, items),
        JsonValue::Object(members) => write_compact_object(output, members),
    }
}

// A number as the `f64` JavaScript holds, so an integer above 2^53 is rounded; `JSON.stringify`
// writes a non-finite number as `null`.
fn number_text(number: &JsonNumber) -> String {
    match FiniteNumber::new(number.to_f64()) {
        Some(finite) => finite.to_string(),
        None => "null".to_owned(),
    }
}

fn write_compact_array(output: &mut String, items: &[JsonValue]) {
    output.push('[');

    for (position, item) in items.iter().enumerate() {
        if position > 0 {
            output.push(',');
        }

        write_compact(output, item);
    }

    output.push(']');
}

fn write_compact_object(output: &mut String, members: &JsonObject) {
    output.push('{');

    for (position, (name, member)) in members.iter().enumerate() {
        if position > 0 {
            output.push(',');
        }

        write_json_string(output, name);
        output.push(':');
        write_compact(output, member);
    }

    output.push('}');
}

#[cfg(test)]
mod tests {
    use super::*;

    fn object(members: Vec<(&str, JsonValue)>) -> JsonValue {
        let mut object = JsonObject::new();

        for (name, member) in members {
            object.insert(name.to_owned(), member);
        }

        JsonValue::Object(object)
    }

    fn number(value: f64) -> JsonValue {
        JsonValue::Number(JsonNumber::from_f64(value).expect("a finite number"))
    }

    #[test]
    fn the_three_prototype_names_are_reserved() {
        for key in ["__proto__", "constructor", "prototype"] {
            assert!(is_reserved_key(key), "key {key:?}");
        }

        for key in ["", "Constructor", "__proto", "proto", "toString", "é"] {
            assert!(!is_reserved_key(key), "key {key:?}");
        }
    }

    #[test]
    fn a_reserved_key_is_an_ordinary_member_of_a_json_object() {
        let mut members = JsonObject::new();

        members.insert("__proto__".to_owned(), number(1.0));

        assert_eq!(members.get("__proto__"), Some(&number(1.0)));
        assert_eq!(members.get("constructor"), None);
    }

    #[test]
    fn a_string_is_shown_as_it_is_and_nothing_for_an_absent_value() {
        assert_eq!(show_value(None), "nothing");
        assert_eq!(
            show_value(Some(&JsonValue::String("a \"b\"".to_owned()))),
            "a \"b\""
        );
    }

    #[test]
    fn any_other_value_is_shown_as_json_stringify_writes_it() {
        assert_eq!(show_value(Some(&JsonValue::Null)), "null");
        assert_eq!(show_value(Some(&JsonValue::Bool(false))), "false");
        assert_eq!(show_value(Some(&number(-0.0))), "0");
        assert_eq!(show_value(Some(&number(1e21))), "1e+21");
        assert_eq!(show_value(Some(&number(0.1))), "0.1");
        assert_eq!(show_value(Some(&JsonValue::Array(vec![]))), "[]");
        assert_eq!(show_value(Some(&object(vec![]))), "{}");
        assert_eq!(
            show_value(Some(&JsonValue::Array(vec![
                JsonValue::Null,
                JsonValue::String("é\n\u{1}".to_owned()),
                number(2.0),
            ]))),
            "[null,\"é\\n\\u0001\",2]"
        );
    }

    #[test]
    fn an_integer_above_2_pow_53_is_shown_as_the_number_javascript_holds() {
        let exact = JsonNumber::from_json_text("9007199254740993").expect("a number");

        assert_eq!(
            show_value(Some(&JsonValue::Number(exact))),
            "9007199254740992"
        );
    }

    #[test]
    fn an_object_is_shown_in_javascript_key_order() {
        let value = object(vec![
            ("b", number(1.0)),
            ("10", number(2.0)),
            ("9", number(3.0)),
            ("a", object(vec![("x", JsonValue::Null)])),
        ]);

        assert_eq!(
            show_value(Some(&value)),
            "{\"9\":3,\"10\":2,\"b\":1,\"a\":{\"x\":null}}"
        );
    }
}
