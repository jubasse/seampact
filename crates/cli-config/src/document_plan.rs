//! The documents an app config plans: the names of the apis its `openapi` key documents.

use seampact_js::js_key_order;

use crate::json_access::record;
use crate::read_app_config::LoadedAppConfig;

/// The api names the app's `openapi` maps to documents; none when it is absent or `none`.
#[must_use]
pub fn open_api_api_names(config: &LoadedAppConfig) -> Vec<String> {
    let Some(object) = record(config.openapi.as_ref()) else {
        return Vec::new();
    };

    js_key_order(object.keys().map(|name| (name, ())))
        .map(|(name, ())| name.clone())
        .collect()
}
