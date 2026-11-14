//! The authored tree as the `serde_json::Value` the schema validator reads.

use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;
use serde_json::Value;

/// The `serde_json` form of an authored value, keeping its key order and its number text.
///
/// # Errors
///
/// An [`InternalError`] when the value cannot be written as `serde_json` (a bug).
pub fn serde_value_of(value: &JsonValue) -> Result<Value, InternalError> {
    serde_json::to_value(value).map_err(|error| {
        InternalError::new(format!(
            "an authored value is not a serde_json value: {error}"
        ))
    })
}

/// The authored form of a `serde_json` value, for a message that quotes it.
///
/// # Errors
///
/// An [`InternalError`] when the value holds a number JSON text cannot carry (a bug).
pub fn authored_value_of(value: &Value) -> Result<JsonValue, InternalError> {
    JsonValue::try_from(value.clone()).map_err(|error| {
        InternalError::new(format!(
            "a validated value is not an authored value: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_value_round_trips_with_its_key_order() -> Result<(), InternalError> {
        let text = r#"{"b":1,"a":[true,null,"x",2.5],"10":{},"2":0}"#;
        let parsed: Value =
            serde_json::from_str(text).map_err(|error| InternalError::new(error.to_string()))?;
        let authored = authored_value_of(&parsed)?;
        let back = serde_value_of(&authored)?;

        assert_eq!(back, parsed);
        // The authored value keeps JavaScript's own-key order: integer keys first.
        assert_eq!(
            back.to_string(),
            r#"{"2":0,"10":{},"b":1,"a":[true,null,"x",2.5]}"#
        );

        Ok(())
    }
}
