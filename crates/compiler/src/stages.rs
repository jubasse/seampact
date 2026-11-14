//! The stages the orchestrator runs besides the halves, and the answer of one that is not ported.
//!
//! Validate, the relay order, link and finalize are ported by later lanes; until then each answers
//! [`StageAnswer::NotPorted`], so the run stops there and says where. Link calls its crate, whose
//! stub answers not ported yet.

use indexmap::IndexMap;
use seampact_authoring::{RawApi, RawWorkspace};
use seampact_diagnostics::{Diagnostic, InternalError};
use seampact_ir::{ContractIr, SourceMap};
use seampact_pipeline::{DraftIr, Half, PassError};

/// A stage of the orchestrator, named where a run reaches one that is not ported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stage {
    /// The validation of the loaded workspace.
    Validate,
    /// The relay order of the workspace's apis.
    RelayOrder,
    /// One half of one api.
    Half(Half),
    /// The link pass over every api's draft.
    Link,
    /// The finalize of one api's draft.
    Finalize,
}

/// What a stage answers: its result, or that it is not ported yet.
#[derive(Debug, Clone, PartialEq)]
pub enum StageAnswer<Output> {
    /// The stage ran.
    Ported(Output),
    /// The stage is not ported: the run stops here without a diagnostic.
    NotPorted,
}

/// The diagnostics of the validation, workspace-wide and per api.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Validated {
    /// The diagnostics of the workspace entry.
    pub workspace: Vec<Diagnostic>,
    /// The diagnostics listed under each api, by api name.
    pub apis: Vec<(String, Vec<Diagnostic>)>,
}

/// The relay order of a workspace: every api once, each after every api its relay routes name.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RelayOrder {
    /// Every workspace api once.
    pub order: Vec<String>,
    /// Per api, the workspace apis its relay routes name: the stop rule skips an api that relays
    /// to a stopped one.
    pub relays_to: IndexMap<String, Vec<String>>,
    /// Errors of the step (a relay cycle names its apis), each listed under an api.
    pub diagnostics: Vec<(String, Vec<Diagnostic>)>,
}

/// What finalize produces for one api: the canonical IR and its side table.
#[derive(Debug, Clone, PartialEq)]
pub struct Finalized {
    /// The finalized IR.
    pub ir: ContractIr,
    /// Where each location of the IR was written.
    pub source_map: SourceMap,
}

/// What one api's finalize gave: the diagnostics it reported, and its output when it has one.
#[derive(Debug, Clone, PartialEq)]
pub struct FinalizeRun {
    /// Every diagnostic finalize reported.
    pub diagnostics: Vec<Diagnostic>,
    /// The IR and source map; an api whose finalize reports an error produces none.
    pub finalized: Option<Finalized>,
}

/// Validates the loaded workspace.
#[must_use]
pub fn validate_workspace(_workspace: &RawWorkspace) -> StageAnswer<Validated> {
    StageAnswer::NotPorted
}

/// The relay order of the workspace's apis.
#[must_use]
pub fn workspace_relay_order(_workspace: &RawWorkspace) -> StageAnswer<RelayOrder> {
    StageAnswer::NotPorted
}

/// Links every api's derived draft, in workspace order; answers the diagnostics it reports, each
/// under the api it belongs to.
///
/// # Errors
///
/// An [`InternalError`] from the link pass.
pub fn link_workspace(
    drafts: &IndexMap<String, DraftIr>,
    workspace: &RawWorkspace,
    imports: &IndexMap<String, ContractIr>,
) -> Result<StageAnswer<Vec<(String, Diagnostic)>>, InternalError> {
    match seampact_pass_link::run(drafts, workspace, imports) {
        Ok(reported) => Ok(StageAnswer::Ported(reported)),
        Err(PassError::NotPortedYet { .. }) => Ok(StageAnswer::NotPorted),
        Err(PassError::Internal(internal)) => Err(internal),
    }
}

/// Finalizes one api's complete draft, which it takes by value: its parts move into the IR.
#[must_use]
pub fn finalize_api(_draft: DraftIr, _raw: &RawApi) -> StageAnswer<FinalizeRun> {
    StageAnswer::NotPorted
}
