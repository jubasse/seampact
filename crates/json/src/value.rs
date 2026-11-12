//! A JSON value as JavaScript holds it.

use serde::de::Error as _;
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{JsonError, JsonNumber, JsonObject, escape_pointer};

/// The largest magnitude written as a JSON integer by [`JsonValue`]'s `Serialize`: 2^53.
const LARGEST_WHOLE_INTEGER: f64 = 9_007_199_254_740_992.0;

/// A JSON value: the opaque values of the IR (examples, defaults, extension values) and of the
/// authoring tree.
///
/// Equality is JavaScript deep equality: numbers compare as `===` does, and objects ignore
/// member order.
///
/// `Serialize` and `Deserialize` target `serde_json` only: a number is written through
/// `serde_json::Number`, which another format writes as a private map. Canonical bytes are
/// written by [`crate::canonical_document`], never through `Serialize`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonValue {
    /// `null`.
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// A finite number.
    Number(JsonNumber),
    /// A string.
    String(String),
    /// An array.
    Array(Vec<JsonValue>),
    /// An object.
    Object(JsonObject),
}

impl TryFrom<serde_json::Value> for JsonValue {
    type Error = JsonError;

    /// Converts a parsed value, reading each number from its text.
    ///
    /// # Errors
    ///
    /// [`JsonError::NumberOutOfRange`] for a number with no finite `f64` (`1e400`), naming its
    /// JSON pointer.
    fn try_from(value: serde_json::Value) -> Result<Self, Self::Error> {
        json_value_at(value, "")
    }
}

fn json_value_at(value: serde_json::Value, pointer: &str) -> Result<JsonValue, JsonError> {
    match value {
        serde_json::Value::Null => Ok(JsonValue::Null),
        serde_json::Value::Bool(flag) => Ok(JsonValue::Bool(flag)),
        serde_json::Value::Number(number) => {
            json_number_at(&number, pointer).map(JsonValue::Number)
        }
        serde_json::Value::String(text) => Ok(JsonValue::String(text)),
        serde_json::Value::Array(items) => items
            .into_iter()
            .enumerate()
            .map(|(index, item)| json_value_at(item, &format!("{pointer}/{index}")))
            .collect::<Result<Vec<_>, _>>()
            .map(JsonValue::Array),
        serde_json::Value::Object(members) => members
            .into_iter()
            .map(|(key, member)| {
                let member_pointer = format!("{pointer}/{}", escape_pointer(&key));

                json_value_at(member, &member_pointer).map(|value| (key, value))
            })
            .collect::<Result<JsonObject, _>>()
            .map(JsonValue::Object),
    }
}

fn json_number_at(number: &serde_json::Number, pointer: &str) -> Result<JsonNumber, JsonError> {
    let text = number.as_str();

    JsonNumber::from_json_text(text).ok_or_else(|| JsonError::NumberOutOfRange {
        text: text.to_owned(),
        pointer: pointer.to_owned(),
    })
}

impl<'de> Deserialize<'de> for JsonValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;

        Self::try_from(value).map_err(D::Error::custom)
    }
}

impl Serialize for JsonValue {
    /// Writes the value for `serde_json`: an exact integer through `serde_json::Number`, an
    /// integral `f64` within 2^53 as an integer, any other `f64` as a float, as `JSON.stringify`
    /// tells them apart.
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Null => serializer.serialize_unit(),
            Self::Bool(flag) => serializer.serialize_bool(*flag),
            Self::Number(number) => serialize_number(number, serializer),
            Self::String(text) => serializer.serialize_str(text),
            Self::Array(items) => {
                let mut sequence = serializer.serialize_seq(Some(items.len()))?;

                for item in items {
                    sequence.serialize_element(item)?;
                }

                sequence.end()
            }
            Self::Object(members) => {
                let mut map = serializer.serialize_map(Some(members.len()))?;

                for (key, member) in members {
                    map.serialize_entry(key, member)?;
                }

                map.end()
            }
        }
    }
}

fn serialize_number<S: Serializer>(number: &JsonNumber, serializer: S) -> Result<S::Ok, S::Error> {
    if let Some(digits) = number.exact_digits() {
        let exact_number: serde_json::Number = digits.parse().map_err(serde::ser::Error::custom)?;

        return exact_number.serialize(serializer);
    }

    let value = number.to_f64();

    match whole_integer(value) {
        Some(integer) => serializer.serialize_i64(integer),
        None => serializer.serialize_f64(value),
    }
}

/// The `i64` of an integral `f64` within 2^53 in magnitude, else `None`.
fn whole_integer(value: f64) -> Option<i64> {
    if value.fract() != 0.0 || value.abs() > LARGEST_WHOLE_INTEGER {
        return None;
    }

    #[expect(
        clippy::cast_possible_truncation,
        reason = "integral and within 2^53, so the cast is exact"
    )]
    let integer = value as i64;

    Some(integer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(text: &str) -> Result<JsonValue, JsonError> {
        JsonValue::try_from(serde_json::from_str::<serde_json::Value>(text).unwrap())
    }

    #[test]
    fn a_number_beyond_f64_is_refused_with_its_pointer() {
        let error = parsed(r#"{"a/b": [1, 1e400]}"#).unwrap_err();

        assert_eq!(
            error,
            JsonError::NumberOutOfRange {
                // serde_json keeps the number text with a signed exponent.
                text: "1e+400".to_owned(),
                pointer: "/a~1b/1".to_owned()
            }
        );
    }

    #[test]
    fn integers_wider_than_64_bits_stay_exact() {
        let value = parsed("[100000000000000000000000000001, -9223372036854775809]").unwrap();
        let JsonValue::Array(items) = value else {
            panic!("not an array: {value:?}")
        };
        let digits: Vec<_> = items
            .iter()
            .map(|item| match item {
                JsonValue::Number(number) => number.to_string(),
                other => panic!("not a number: {other:?}"),
            })
            .collect();

        assert_eq!(
            digits,
            ["100000000000000000000000000001", "-9223372036854775809"]
        );
    }

    #[test]
    fn serialize_writes_integers_floats_and_exact_digits_for_serde_json() {
        let value =
            parsed(r#"{"whole": 4.04e2, "fraction": 1.5, "exact": 9007199254740993, "zero": -0}"#)
                .unwrap();
        let text = serde_json::to_string(&value).unwrap();

        assert_eq!(
            text,
            r#"{"whole":404,"fraction":1.5,"exact":9007199254740993,"zero":0}"#
        );
    }

    #[test]
    fn deserialize_reads_the_same_value_as_try_from() {
        let text = r#"{"b": [true, null, "x"], "200": 1e-17, "a": {}}"#;
        let deserialized: JsonValue = serde_json::from_str(text).unwrap();

        assert_eq!(deserialized, parsed(text).unwrap());
    }

    #[test]
    fn deserialize_refuses_a_number_beyond_f64() {
        let error = serde_json::from_str::<JsonValue>("[1e400]").unwrap_err();

        assert!(error.to_string().contains("1e+400 at '/0'"), "{error}");
    }

    #[test]
    fn values_compare_as_javascript_deep_equality() {
        assert_eq!(
            parsed(r#"{"a": 0, "b": 1}"#).unwrap(),
            parsed(r#"{"b": 1.0, "a": -0}"#).unwrap()
        );
        assert_ne!(parsed("[1, 2]").unwrap(), parsed("[2, 1]").unwrap());
    }
}
