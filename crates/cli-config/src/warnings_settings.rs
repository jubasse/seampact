//! The `warnings` of an app config read into their typed members.

use seampact_diagnostics::InternalError;
use serde::Deserialize;

use crate::read_app_config::LoadedAppConfig;

/// The members of the app config's `warnings`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub struct WarningsSettings {
    /// The forms of generated code whose warning the app silences.
    #[serde(default)]
    pub ignore: Vec<String>,
}

impl LoadedAppConfig {
    /// The app's `warnings`; nothing ignored when the app writes none.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the `warnings` that passed the config schema do not read.
    pub fn warnings_settings(&self) -> Result<WarningsSettings, InternalError> {
        let Some(warnings) = &self.warnings else {
            return Ok(WarningsSettings::default());
        };
        let value = serde_json::to_value(warnings).map_err(|error| {
            InternalError::new(format!("the warnings do not serialise: {error}"))
        })?;

        serde_json::from_value(value).map_err(|error| {
            InternalError::new(format!(
                "warnings that passed the schema do not read: {error}"
            ))
        })
    }
}
