//! A document as the YAML text a file holds.

use std::fmt::Write as _;

use saphyr::{Mapping, Scalar, ScalarStyle, Yaml, YamlEmitter};
use seampact_diagnostics::InternalError;
use seampact_json::{JsonObject, JsonValue};

use crate::OpenApiError;

/// The YAML text of a document: LF line ends, a final newline, no alias for a repeated object.
///
/// # Errors
///
/// [`OpenApiError::Internal`] when the emitter fails to write.
pub(crate) fn serialize_document(document: &JsonObject) -> Result<String, OpenApiError> {
    let yaml = object_yaml(document);
    let mut text = String::new();

    YamlEmitter::new(&mut text)
        .dump(&yaml)
        .map_err(|error| InternalError::new(format!("the YAML emitter failed: {error}")))?;

    let body = text.strip_prefix("---\n").unwrap_or(&text);

    Ok(format!("{}\n", body.trim_end_matches('\n')))
}

fn object_yaml(object: &JsonObject) -> Yaml<'static> {
    let mut mapping = Mapping::new();

    for (key, value) in object {
        mapping.insert(string_yaml(key), value_yaml(value));
    }

    Yaml::Mapping(mapping)
}

fn string_yaml(text: &str) -> Yaml<'static> {
    if text.chars().any(is_double_quoted_control) {
        return Yaml::Representation(
            escaped_for_double_quotes(text).into(),
            ScalarStyle::DoubleQuoted,
            None,
        );
    }

    Yaml::Value(Scalar::String(text.to_owned().into()))
}

/// DEL and the C1 controls: the TypeScript `yaml` double-quotes a string holding one, where the
/// Rust emitter writes it plain.
fn is_double_quoted_control(character: char) -> bool {
    ('\u{7F}'..='\u{9F}').contains(&character)
}

/// The body of a double-quoted scalar: the controls below U+0020 escaped, the rest written as is.
fn escaped_for_double_quotes(text: &str) -> String {
    let mut quoted = String::with_capacity(text.len());

    for character in text.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\t' => quoted.push_str("\\t"),
            control if control < ' ' => {
                let _ = write!(quoted, "\\x{:02X}", u32::from(control));
            }
            other => quoted.push(other),
        }
    }

    quoted
}

fn value_yaml(value: &JsonValue) -> Yaml<'static> {
    match value {
        JsonValue::Null => Yaml::Value(Scalar::Null),
        JsonValue::Bool(flag) => Yaml::Value(Scalar::Boolean(*flag)),
        JsonValue::Number(number) => {
            Yaml::Representation(number.to_string().into(), ScalarStyle::Plain, None)
        }
        JsonValue::String(text) => string_yaml(text),
        JsonValue::Array(items) => Yaml::Sequence(items.iter().map(value_yaml).collect()),
        JsonValue::Object(object) => object_yaml(object),
    }
}

#[cfg(test)]
mod tests {
    use proptest::prelude::*;
    use saphyr::LoadableYamlNode;

    use super::*;

    fn text_of(members: Vec<(&str, JsonValue)>) -> Result<String, OpenApiError> {
        let mut document = JsonObject::new();

        for (key, value) in members {
            document.insert(key.to_owned(), value);
        }

        serialize_document(&document)
    }

    fn number(text: &str) -> JsonValue {
        JsonValue::Number(
            seampact_json::JsonNumber::from_json_text(text)
                .unwrap_or_else(|| panic!("{text} is no JSON number")),
        )
    }

    #[test]
    fn numbers_are_written_as_ecmascript_text() -> Result<(), OpenApiError> {
        let text = text_of(vec![
            ("big", number("1e21")),
            ("zero", number("-0")),
            ("tiny", number("1e-7")),
            ("exact", number("9007199254740993")),
        ])?;

        assert_eq!(
            text,
            "big: 1e+21\nzero: 0\ntiny: 1e-7\nexact: 9007199254740993\n"
        );

        Ok(())
    }

    #[test]
    fn strings_that_look_like_other_scalars_stay_strings() -> Result<(), OpenApiError> {
        let text = text_of(vec![
            ("200", JsonValue::String("true".to_owned())),
            ("code", JsonValue::String("123".to_owned())),
            ("astral", JsonValue::String("\u{1F600}".to_owned())),
        ])?;
        let documents = Yaml::load_from_str(&text).map_err(|error| {
            seampact_diagnostics::InternalError::new(format!("the text does not parse: {error}"))
        })?;
        let parsed = documents.first().and_then(Yaml::as_mapping);
        let value_of = |key: &str| {
            parsed
                .and_then(|mapping| {
                    mapping.get(&Yaml::Value(Scalar::String(key.to_owned().into())))
                })
                .and_then(Yaml::as_str)
                .map(str::to_owned)
        };

        assert!(
            text.ends_with('\n') && !text.starts_with("---"),
            "text {text:?}"
        );
        assert_eq!(value_of("200"), Some("true".to_owned()), "text {text:?}");
        assert_eq!(value_of("code"), Some("123".to_owned()), "text {text:?}");
        assert_eq!(
            value_of("astral"),
            Some("\u{1F600}".to_owned()),
            "text {text:?}"
        );

        Ok(())
    }

    fn json_values() -> impl Strategy<Value = serde_json::Value> {
        let leaf = prop_oneof![
            Just(serde_json::Value::Null),
            any::<bool>().prop_map(serde_json::Value::Bool),
            any::<i64>().prop_map(serde_json::Value::from),
            any::<String>().prop_map(serde_json::Value::String),
        ];

        leaf.prop_recursive(3, 24, 4, |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 0..4).prop_map(serde_json::Value::Array),
                prop::collection::hash_map(any::<String>(), inner, 0..4)
                    .prop_map(|members| serde_json::Value::Object(members.into_iter().collect())),
            ]
        })
    }

    proptest! {
        #[test]
        fn any_document_is_written_and_read_back_as_the_same_value(
            members in prop::collection::hash_map(any::<String>(), json_values(), 0..5),
        ) {
            let expected = serde_json::Value::Object(members.into_iter().collect());
            let document = match JsonValue::try_from(expected.clone()) {
                Ok(JsonValue::Object(object)) => object,
                other => return Err(TestCaseError::fail(format!("not an object: {other:?}"))),
            };
            let text = serialize_document(&document)
                .map_err(|error| TestCaseError::fail(error.to_string()))?;
            let read = seampact_oracle::yaml_to_json(&text).map_err(TestCaseError::fail)?;

            prop_assert_eq!(read, expected, "text {:?}", text);
        }
    }

    #[test]
    fn a_c1_control_character_is_double_quoted() -> Result<(), OpenApiError> {
        let text = text_of(vec![
            ("k", JsonValue::text("\u{80}")),
            ("nel", JsonValue::text("\u{85}")),
        ])?;

        assert_eq!(text, "k: \"\u{80}\"\nnel: \"\u{85}\"\n");

        Ok(())
    }
}
