//! Typed reads of a part of the untyped IR document.

use seampact_json::JsonValue;
use serde::de::DeserializeOwned;

use crate::IrError;

/// Decodes a member into an IR type; an absent member reads as `null`.
///
/// # Errors
///
/// [`IrError::Decode`] when the value is no `T`, [`IrError::Encode`] when it does not encode.
pub(super) fn decode_member<T: DeserializeOwned>(value: Option<&JsonValue>) -> Result<T, IrError> {
    let encoded =
        serde_json::to_value(value.unwrap_or(&JsonValue::Null)).map_err(IrError::Encode)?;

    serde_json::from_value(encoded).map_err(IrError::Decode)
}
