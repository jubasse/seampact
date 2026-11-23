//! The one reader of a target's raw `options` into its typed options.

use seampact_json::{JsonReadError, JsonReadKind, JsonValue, from_json_value, pointer_segments};
use serde::de::DeserializeOwned;

use crate::{Refusal, Refused, refusal_code};

/// Reads the entry's raw `options` as `T`; absent options read as `{}`.
///
/// `T` derives `Deserialize` with `deny_unknown_fields`, so a key it does not know is refused by
/// name.
///
/// # Errors
///
/// `options.unknown` at `/<key>` for a key `T` refuses, `options.invalid` at the failing pointer
/// for any other value `T` cannot read.
pub fn parse_options<T: DeserializeOwned>(raw: Option<&JsonValue>) -> Result<T, Refused> {
    let absent = JsonValue::object([]);

    from_json_value(raw.unwrap_or(&absent)).map_err(|error| Refused(vec![refusal_of(&error)]))
}

fn refusal_of(error: &JsonReadError) -> Refusal {
    match error.kind {
        JsonReadKind::UnknownMember => {
            let key = pointer_segments(&error.pointer)
                .and_then(|segments| segments.last().cloned())
                .unwrap_or_default();

            Refusal::new(
                refusal_code::OPTIONS_UNKNOWN,
                format!("The option '{key}' is not one this target knows."),
                format!("Remove '{key}' from the target's `options`."),
            )
            .with_member(&error.pointer)
        }
        JsonReadKind::Invalid => Refusal::new(
            refusal_code::OPTIONS_INVALID,
            format!("The target options are not valid: {}.", error.reason),
            "Write the target's `options` as its documentation describes, or leave them out.",
        )
        .with_member(&error.pointer),
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;
    use crate::NoOptions;

    #[derive(Debug, Deserialize, PartialEq)]
    #[serde(deny_unknown_fields)]
    struct StyleOptions {
        #[serde(default)]
        style: Option<String>,
        #[serde(default)]
        nested: Option<NoOptions>,
    }

    fn options(text: &str) -> JsonValue {
        let value: serde_json::Value = serde_json::from_str(text).unwrap();

        JsonValue::try_from(value).unwrap()
    }

    fn refusal_of_failure<T: std::fmt::Debug>(result: Result<T, Refused>) -> Refusal {
        result.unwrap_err().0.into_iter().next().unwrap()
    }

    #[test]
    fn absent_options_read_as_an_empty_object() {
        let parsed: StyleOptions = parse_options(None).unwrap();

        assert_eq!(
            parsed,
            StyleOptions {
                style: None,
                nested: None
            }
        );
    }

    #[test]
    fn an_unknown_key_is_refused_at_its_pointer() {
        let refusal = refusal_of_failure(parse_options::<StyleOptions>(Some(&options(
            r#"{"nested": {"a/b": 1}}"#,
        ))));

        assert_eq!(refusal.code, refusal_code::OPTIONS_UNKNOWN);
        assert_eq!(refusal.member.as_deref(), Some("/nested/a~1b"));
        assert!(refusal.message.contains("'a/b'"), "{}", refusal.message);
    }

    #[test]
    fn a_wrong_value_is_refused_at_its_pointer() {
        let refusal = refusal_of_failure(parse_options::<StyleOptions>(Some(&options(
            r#"{"style": 3}"#,
        ))));

        assert_eq!(refusal.code, refusal_code::OPTIONS_INVALID);
        assert_eq!(refusal.member.as_deref(), Some("/style"));
    }

    #[test]
    fn options_that_are_no_object_are_refused_at_the_root() {
        let refusal = refusal_of_failure(parse_options::<NoOptions>(Some(&options("[1]"))));

        assert_eq!(refusal.code, refusal_code::OPTIONS_INVALID);
        assert_eq!(refusal.member.as_deref(), Some(""));
    }

    #[test]
    fn a_target_without_options_takes_an_empty_object_only() {
        assert!(parse_options::<NoOptions>(None).is_ok());
        assert!(parse_options::<NoOptions>(Some(&options("{}"))).is_ok());

        let refusal = refusal_of_failure(parse_options::<NoOptions>(Some(&options(r#"{"x": 1}"#))));

        assert_eq!(refusal.code, refusal_code::OPTIONS_UNKNOWN);
        assert_eq!(refusal.member.as_deref(), Some("/x"));
    }
}
