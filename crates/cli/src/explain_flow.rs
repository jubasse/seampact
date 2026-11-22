//! The YAML flow text `seampact explain` writes a value as, and the type names it shows.

use seampact_json::{JsonObject, JsonValue, js_text_of, write_json_string};

/// The members of `value` when it is a mapping, else none.
pub(crate) fn object_of(value: Option<&JsonValue>) -> Option<&JsonObject> {
    match value {
        Some(JsonValue::Object(object)) => Some(object),
        _ => None,
    }
}

/// The items of `value` when it is an array, else none.
pub(crate) fn items_of(value: Option<&JsonValue>) -> &[JsonValue] {
    match value {
        Some(JsonValue::Array(items)) => items,
        _ => &[],
    }
}

/// Whether `text` is the string `expected`.
pub(crate) fn is_text(value: Option<&JsonValue>, expected: &str) -> bool {
    matches!(value, Some(JsonValue::String(text)) if text == expected)
}

/// An object of the members whose value is present, in the order given; a member the TypeScript
/// leaves `undefined` is `None` and left out, as the flow text leaves it out.
pub(crate) fn object_of_present<'value>(
    members: impl IntoIterator<Item = (&'static str, Option<&'value JsonValue>)>,
) -> JsonValue {
    JsonValue::Object(
        members
            .into_iter()
            .filter_map(|(name, value)| value.map(|value| (name.to_owned(), value.clone())))
            .collect(),
    )
}

/// A value as a YAML flow: `[a, b]`, `{ key: value }`, a string plain when a YAML reader would
/// read it back as that string and JSON-quoted otherwise.
pub(crate) fn flow(value: &JsonValue) -> String {
    match value {
        JsonValue::Array(items) => {
            let texts: Vec<String> = items.iter().map(flow).collect();

            format!("[{}]", texts.join(", "))
        }
        JsonValue::Object(object) => {
            let members: Vec<String> = object
                .iter()
                .map(|(key, member)| format!("{key}: {}", flow(member)))
                .collect();

            if members.is_empty() {
                "{}".to_owned()
            } else {
                format!("{{ {} }}", members.join(", "))
            }
        }
        JsonValue::String(text) => flow_text(text),
        other => js_text_of(Some(other)),
    }
}

/// [`flow`] of a member that may be absent, which JavaScript writes `undefined`.
pub(crate) fn flow_of(value: Option<&JsonValue>) -> String {
    value.map_or_else(|| "undefined".to_owned(), flow)
}

fn flow_text(text: &str) -> String {
    if is_plain_text(text) && !is_yaml_keyword(text) {
        return text.to_owned();
    }

    let mut quoted = String::new();

    write_json_string(&mut quoted, text);

    quoted
}

/// `^[A-Za-z_/][\w./-]*$`.
fn is_plain_text(text: &str) -> bool {
    let mut characters = text.chars();
    let starts_plain = characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_' || first == '/');

    starts_plain
        && characters.all(|each| {
            each.is_ascii_alphanumeric() || matches!(each, '_' | '.' | '/' | '-')
        })
}

/// Words a YAML reader takes for a boolean or null when written plain.
fn is_yaml_keyword(text: &str) -> bool {
    ["true", "false", "null", "yes", "no", "on", "off", "y", "n"]
        .iter()
        .any(|word| text.eq_ignore_ascii_case(word))
}

/// The name a type use shows: a schema ref its schema, a scalar its format, scalar or type, an
/// enum its name, an array its items in brackets, anything else its kind.
pub(crate) fn type_text(type_use: Option<&JsonValue>) -> String {
    let Some(JsonValue::Object(object)) = type_use else {
        return js_text_of(type_use);
    };

    match object.get("kind") {
        Some(JsonValue::String(kind)) => match kind.as_str() {
            "ref" => js_text_of(object.get("schema")),
            "scalar" => {
                let named = ["format", "scalar", "type"]
                    .iter()
                    .filter_map(|member| object.get(member))
                    .find(|value| **value != JsonValue::Null);

                js_text_of(named)
            }
            "enum" => js_text_of(object.get("enum")),
            "array" => format!("[{}]", type_text(object.get("items"))),
            _ => js_text_of(object.get("kind")),
        },
        other => js_text_of(other),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(text: &str) -> JsonValue {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn strings_stay_plain_only_when_a_yaml_reader_reads_them_back_as_strings() {
        for (text, flowed) in [
            ("getOrder", "getOrder"),
            ("/orders/{id}", "\"/orders/{id}\""),
            ("true", "\"true\""),
            ("No", "\"No\""),
            ("nothing", "nothing"),
            ("a-b.c/d", "a-b.c/d"),
            ("1abc", "\"1abc\""),
            ("", "\"\""),
            ("caf\u{e9}", "\"caf\u{e9}\""),
            ("a\nb", "\"a\\nb\""),
        ] {
            assert_eq!(flow(&JsonValue::text(text)), flowed, "text {text:?}");
        }
    }

    #[test]
    fn numbers_flow_as_javascript_writes_them() {
        for (text, flowed) in [("1e21", "1e+21"), ("0.1", "0.1"), ("-0", "0"), ("7", "7")] {
            assert_eq!(flow(&json(text)), flowed, "number {text}");
        }
    }

    #[test]
    fn containers_flow_in_member_order_and_an_empty_mapping_is_braces() {
        assert_eq!(flow(&json(r#"{"b":[1,"x y"],"a":{}}"#)), "{ b: [1, \"x y\"], a: {} }");
        assert_eq!(flow(&json("[]")), "[]");
        assert_eq!(flow(&json("null")), "null");
    }

    #[test]
    fn a_type_use_shows_the_first_name_it_has() {
        assert_eq!(type_text(Some(&json(r#"{"kind":"scalar","scalar":"int"}"#))), "int");
        assert_eq!(
            type_text(Some(&json(r#"{"kind":"scalar","format":"uuid","scalar":"string"}"#))),
            "uuid"
        );
        assert_eq!(type_text(Some(&json(r#"{"kind":"array","items":{"kind":"ref","schema":"Order"}}"#))), "[Order]");
        assert_eq!(type_text(Some(&json(r#"{"kind":"array"}"#))), "[undefined]");
        assert_eq!(type_text(Some(&json(r#"{"kind":"map"}"#))), "map");
        assert_eq!(type_text(None), "undefined");
    }
}
