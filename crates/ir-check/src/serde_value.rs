//! The `serde_json` value `jsonschema` reads, with every number written from its `f64`.

use seampact_json::{JsonNumber, JsonValue, MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, escape_pointer};
use serde_json::{Map, Number, Value};

use crate::IrCheckError;

/// `value` as a `serde_json` value, each number written from its `f64`.
///
/// `jsonschema` compares numbers exactly where Ajv compared `f64`: an integer above 2^53 and a
/// decimal such as `0.3` must reach it as the `f64` JavaScript holds, or `multipleOf` and the
/// bounds disagree. An integral `f64` within the safe range is written as an integer, any other
/// as a float.
///
/// # Errors
///
/// [`IrCheckError::NumberNotFinite`] for a number with no finite `f64` (never built by the JSON
/// reader).
pub fn serde_value_through_f64(value: &JsonValue) -> Result<Value, IrCheckError> {
    convert(value, "")
}

fn convert(value: &JsonValue, pointer: &str) -> Result<Value, IrCheckError> {
    Ok(match value {
        JsonValue::Null => Value::Null,
        JsonValue::Bool(flag) => Value::Bool(*flag),
        JsonValue::Number(number) => Value::Number(number_through_f64(number, pointer)?),
        JsonValue::String(text) => Value::String(text.clone()),
        JsonValue::Array(items) => {
            let converted: Result<Vec<Value>, IrCheckError> = items
                .iter()
                .enumerate()
                .map(|(index, item)| convert(item, &format!("{pointer}/{index}")))
                .collect();

            Value::Array(converted?)
        }
        JsonValue::Object(members) => {
            let mut converted = Map::new();

            for (key, member) in members {
                let at = format!("{pointer}/{}", escape_pointer(key));

                converted.insert(key.clone(), convert(member, &at)?);
            }

            Value::Object(converted)
        }
    })
}

fn number_through_f64(number: &JsonNumber, pointer: &str) -> Result<Number, IrCheckError> {
    if let Ok(integer) =
        seampact_json::js_integer_in_range(number, MIN_SAFE_INTEGER..=MAX_SAFE_INTEGER)
    {
        return Ok(Number::from(integer));
    }

    Number::from_f64(number.to_f64()).ok_or_else(|| IrCheckError::NumberNotFinite {
        pointer: pointer.to_owned(),
        number: number.to_string(),
    })
}
