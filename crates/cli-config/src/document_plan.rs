//! The documents an app config plans: the names of the apis its `openapi` key documents.

use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_js::js_key_order;
use seampact_json::JsonValue;
use serde::Deserialize;
use serde::de::IgnoredAny;

use crate::read_app_config::LoadedAppConfig;

/// The text of `openapi: none`, the app writing no document.
const NO_OPENAPI_DOCUMENTS: &str = "none";

/// The apis an app's `openapi` documents, in the order the TypeScript reads object keys; empty
/// for `openapi: none`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct OpenApiSettings {
    /// The api names the `openapi` mapping writes.
    pub apis: Vec<String>,
}

// The key as the config writes it: `none`, or a mapping from api names to their documents.
#[derive(Deserialize)]
#[serde(untagged)]
enum WrittenOpenApi {
    Switch(String),
    Documents(IndexMap<String, IgnoredAny>),
}

impl OpenApiSettings {
    /// The settings of an `openapi` value the config schema passed.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the value is neither `none` nor a mapping.
    pub fn from_value(value: &JsonValue) -> Result<Self, InternalError> {
        let written: WrittenOpenApi = serde_json::to_value(value)
            .and_then(serde_json::from_value)
            .map_err(|error| {
                InternalError::new(format!(
                    "an openapi value outside the schema's passed it: {error}"
                ))
            })?;

        match written {
            WrittenOpenApi::Switch(text) if text == NO_OPENAPI_DOCUMENTS => Ok(Self::default()),
            WrittenOpenApi::Switch(text) => Err(InternalError::new(format!(
                "an openapi text '{text}' passed the schema"
            ))),
            WrittenOpenApi::Documents(documents) => Ok(Self {
                apis: js_key_order(documents.keys().map(|name| (name, ())))
                    .map(|(name, ())| name.clone())
                    .collect(),
            }),
        }
    }
}

impl LoadedAppConfig {
    /// The app's `openapi` settings; `None` when the app does not write the key.
    ///
    /// # Errors
    ///
    /// [`InternalError`] as [`OpenApiSettings::from_value`].
    pub fn openapi_settings(&self) -> Result<Option<OpenApiSettings>, InternalError> {
        self.openapi
            .as_ref()
            .map(OpenApiSettings::from_value)
            .transpose()
    }
}

/// The api names the app's `openapi` maps to documents; none when it is absent or `none`.
///
/// # Errors
///
/// [`InternalError`] as [`OpenApiSettings::from_value`].
pub fn open_api_api_names(config: &LoadedAppConfig) -> Result<Vec<String>, InternalError> {
    Ok(config
        .openapi_settings()?
        .map(|settings| settings.apis)
        .unwrap_or_default())
}
