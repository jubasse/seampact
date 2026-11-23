//! A target entry planned for generation: its target and each api it generates.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_cli_config::ConfiguredTargetEntry;
use seampact_diagnostics::InternalError;
use seampact_ir::ContractIr;
use seampact_span::Location;
use seampact_target::Generator;

/// One api an entry generates: its IR filtered to the entry's operations, and where it writes.
#[derive(Debug, Clone)]
pub struct PlannedApi {
    /// The api id.
    pub api: String,
    /// The source holding the api.
    pub source: String,
    /// The IR the entry's operations leave.
    pub ir: ContractIr,
    /// The output directory of this api.
    pub root: Utf8PathBuf,
    /// The file and line of each declaration; absent for an api read from a bundle.
    pub located: Option<IndexMap<String, Location>>,
}

/// A target entry with its resolved target and its apis.
#[derive(Clone)]
pub struct PlannedEntry {
    /// The entry and its output directory.
    pub entry: ConfiguredTargetEntry,
    /// The generator the entry's `use` names.
    pub target: &'static dyn Generator,
    /// The apis, in the entry's order.
    pub apis: Vec<PlannedApi>,
}

impl std::fmt::Debug for PlannedEntry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PlannedEntry")
            .field("entry", &self.entry.settings.id)
            .field("target", &self.target.metadata().id)
            .field("apis", &self.apis)
            .finish()
    }
}

/// Takes the planned entry `entry_id` out of `planned`.
///
/// # Errors
///
/// [`InternalError`] when the entry was not planned, which the plan's order forbids.
pub fn planned_entry(
    planned: &mut IndexMap<String, PlannedEntry>,
    entry_id: &str,
) -> Result<PlannedEntry, InternalError> {
    planned
        .shift_remove(entry_id)
        .ok_or_else(|| InternalError::new(format!("no planned entry {entry_id}")))
}
