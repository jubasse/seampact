//! The origin of a catalogue entry or an operation, read from its JSON.

use seampact_diagnostics::InternalError;
use seampact_ir::Origin;
use seampact_json::{JsonObject, JsonValue};

/// The `origin` member of `entry`, `None` when the entry is no object or has none.
///
/// # Errors
///
/// An [`InternalError`] when the member is no origin: a pass wrote it.
pub(crate) fn origin_of(entry: &JsonValue) -> Result<Option<Origin>, InternalError> {
    let JsonValue::Object(members) = entry else {
        return Ok(None);
    };

    origin_member(members)
}

/// The `origin` member of an object.
pub(crate) fn origin_member(members: &JsonObject) -> Result<Option<Origin>, InternalError> {
    let Some(origin) = members.get("origin") else {
        return Ok(None);
    };
    let value = serde_json::to_value(origin)
        .map_err(|error| InternalError::new(format!("an origin does not encode: {error}")))?;

    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| InternalError::new(format!("finalize found a malformed origin: {error}")))
}
