//! The `checks` of an app config read into their typed levels.

use seampact_diagnostics::InternalError;
use serde::Deserialize;

use crate::check_level::{CheckLevel, MatrixCheckLevel};
use crate::read_app_config::LoadedAppConfig;

/// The members of `spec/src/config/checks-config.ts#AppChecks`; each absent when not written.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Deserialize)]
pub struct AppChecksSettings {
    /// How `check` reports a drift of the OpenAPI documents.
    #[serde(default)]
    pub openapi: Option<CheckLevel>,
    /// How `check` reports a drift of the generated files.
    #[serde(default)]
    pub generated: Option<CheckLevel>,
    /// How an untested framework major is reported.
    #[serde(default)]
    pub matrix: Option<MatrixCheckLevel>,
}

impl LoadedAppConfig {
    /// The app's `checks`; every level absent when the app writes none.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the `checks` that passed the config schema do not read.
    pub fn checks(&self) -> Result<AppChecksSettings, InternalError> {
        let Some(checks) = &self.checks else {
            return Ok(AppChecksSettings::default());
        };
        let value = serde_json::to_value(checks)
            .map_err(|error| InternalError::new(format!("the checks do not serialise: {error}")))?;

        serde_json::from_value(value).map_err(|error| {
            InternalError::new(format!(
                "checks that passed the schema do not read: {error}"
            ))
        })
    }
}
