//! A target entry planned for generation: everything the run knows about it.

use camino::Utf8PathBuf;
use indexmap::IndexMap;
use seampact_cli_config::{ConfiguredTargetEntry, TargetEntrySettings};
use seampact_ir::ContractIr;
use seampact_span::Location;
use seampact_target::{ArtefactSet, Generator, TargetRole};

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

/// A target entry with its resolved target, role and artefacts, and its apis.
#[derive(Debug, Clone)]
pub struct PlannedEntry {
    /// The entry's members.
    pub settings: TargetEntrySettings,
    /// The absolute output directory.
    pub root: Utf8PathBuf,
    /// The generator the entry's `use` names.
    pub target: &'static dyn Generator,
    /// The role of the entry's target.
    pub role: TargetRole,
    /// The artefacts the entry switches on, in the target's declaration order.
    pub artefacts: ArtefactSet,
    /// The apis, in the entry's order; empty until the app plan has planned them.
    pub apis: Vec<PlannedApi>,
}

impl PlannedEntry {
    /// An entry whose target is resolved and whose artefacts are selected, before its apis are
    /// planned.
    #[must_use]
    pub fn resolved(
        entry: &ConfiguredTargetEntry,
        target: &'static dyn Generator,
        artefacts: ArtefactSet,
    ) -> Self {
        Self {
            settings: entry.settings.clone(),
            root: entry.root.clone(),
            target,
            role: target.metadata().role,
            artefacts,
            apis: Vec::new(),
        }
    }
}
