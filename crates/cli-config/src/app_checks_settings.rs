//! The `checks` of an app config read into their typed levels.

use seampact_diagnostics::InternalError;
use seampact_json::{JsonValue, from_json_value};
use serde::Deserialize;

use crate::check_level::{CheckLevel, MatrixCheckLevel};

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

impl AppChecksSettings {
    /// The settings of a `checks` value the config schema passed; every level absent for none.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the value does not read as `checks`.
    pub fn from_value(checks: Option<&JsonValue>) -> Result<Self, InternalError> {
        let Some(checks) = checks else {
            return Ok(Self::default());
        };

        from_json_value(checks).map_err(|error| {
            InternalError::new(format!(
                "checks that passed the schema do not read: {error}"
            ))
        })
    }
}
