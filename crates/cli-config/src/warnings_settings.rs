//! The `warnings` of an app config read into their typed members.

use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, from_json_value};
use serde::Deserialize;

/// The members of the app config's `warnings`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct WarningsSettings {
    /// The forms of generated code whose warning the app silences.
    #[serde(default)]
    pub ignore: Vec<String>,
}

impl WarningsSettings {
    /// The settings of a `warnings` value the config schema passed; nothing ignored for none.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the value does not read as `warnings`.
    pub fn from_value(warnings: Option<&JsonValue>) -> Result<Self, InternalError> {
        let Some(warnings) = warnings else {
            return Ok(Self::default());
        };

        from_json_value(warnings).map_err(|error| {
            InternalError::new(format!(
                "warnings that passed the schema do not read: {error}"
            ))
        })
    }
}
