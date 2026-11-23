//! A target entry of an app config read into its typed members.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_diagnostics::InternalError;
use seampact_json::JsonValue;
use serde::Deserialize;

use crate::artefact_switch::ArtefactSwitches;
use crate::framework_route_entry::FrameworkRouteEntry;
use crate::operations_filter::OperationsFilter;
use crate::read_app_config::LoadedAppConfig;

/// Whether a server target switches its framework's own OpenAPI document off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameworkDocsSwitch {
    /// The framework's document stays (the default).
    Keep,
    /// The target switches it off.
    Off,
}

/// The members of a `targets` entry, as `spec/src/config/app-config.ts#TargetEntry`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetEntrySettings {
    /// The entry id.
    pub id: String,
    /// The target's package or short id, the `use` key.
    #[serde(rename = "use")]
    pub use_name: String,
    /// The one api the entry names.
    #[serde(default)]
    pub api: Option<String>,
    /// The apis the entry names.
    #[serde(default)]
    pub apis: Option<Vec<String>>,
    /// The api document the entry serves.
    #[serde(default)]
    pub document: Option<String>,
    /// The output directory below `outDir`; the id when absent.
    #[serde(default)]
    pub out: Option<String>,
    /// The provider entry id of each link kind the target consumes.
    #[serde(default)]
    pub link: IndexMap<String, String>,
    /// The target's options as the config writes them.
    #[serde(default)]
    pub options: Option<JsonValue>,
    /// The operations the entry serves or generates.
    #[serde(default)]
    pub operations: Option<OperationsFilter>,
    /// The artefact switches.
    #[serde(default)]
    pub artefacts: Option<ArtefactSwitches>,
    /// The framework majors accepted without the matrix warning.
    #[serde(default)]
    pub allow_untested: Vec<String>,
    /// The path prefix a server serves every route under.
    #[serde(default)]
    pub mount: Option<String>,
    /// The server's routes outside the contract the boot check accepts.
    #[serde(default)]
    pub framework_routes: Vec<FrameworkRouteEntry>,
    /// Whether the target switches its framework's own docs off.
    #[serde(default)]
    pub framework_docs: Option<FrameworkDocsSwitch>,
}

/// A target entry with its absolute output directory.
#[derive(Debug, Clone, PartialEq)]
pub struct ConfiguredTargetEntry {
    /// The entry's members.
    pub settings: TargetEntrySettings,
    /// The absolute output directory.
    pub root: Utf8PathBuf,
}

impl LoadedAppConfig {
    /// The target entries in order, each read into its typed members.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when an entry that passed the config schema does not read.
    pub fn target_entries(&self) -> Result<Vec<ConfiguredTargetEntry>, InternalError> {
        self.entries
            .iter()
            .map(|each| {
                Ok(ConfiguredTargetEntry {
                    settings: TargetEntrySettings::from_json(&each.entry)?,
                    root: each.root.clone(),
                })
            })
            .collect()
    }
}

impl TargetEntrySettings {
    /// Reads an entry that passed the config schema.
    ///
    /// # Errors
    ///
    /// [`InternalError`] when the value does not read as a target entry.
    pub fn from_json(entry: &JsonValue) -> Result<Self, InternalError> {
        let value = serde_json::to_value(entry).map_err(|error| {
            InternalError::new(format!("a target entry does not serialise: {error}"))
        })?;

        serde_json::from_value(value).map_err(|error| {
            InternalError::new(format!(
                "a target entry that passed the schema does not read: {error}"
            ))
        })
    }
}
