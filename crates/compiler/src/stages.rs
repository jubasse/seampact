//! The stages the orchestrator runs besides the halves, and the answer of one that is not ported.
//!
//! Validate, the relay order, link and finalize are ported. Link calls its crate, which answers not
//! ported yet for a relay to an imported operation.

use indexmap::IndexMap;
use seampact_authoring::{RawApi, RawWorkspace};
use seampact_diagnostics::{Diagnostic, InternalError};
use seampact_finalize::{FinalizeContext, Finalized, PackFileParts, PackFiles, finalize};
use seampact_ir::ImportedIr;
use seampact_load::{is_inside, pack_file_parts, pack_vendored_file};
use seampact_pipeline::{DraftIr, Half, PassError};
use seampact_span::SourceFiles;

use crate::relay;

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

/// What one api's finalize gave: the diagnostics it reported, and its output when it has one.
#[derive(Debug, Clone, PartialEq)]
pub struct FinalizeRun {
    /// Every diagnostic finalize reported.
    pub diagnostics: Vec<Diagnostic>,
    /// The IR and source map; an api whose finalize reports an error produces none.
    pub finalized: Option<Finalized>,
}

/// Validates the loaded workspace.
///
/// # Errors
///
/// An [`InternalError`] from the validate stage.
pub fn validate_workspace(
    workspace: &RawWorkspace,
) -> Result<StageAnswer<Validated>, InternalError> {
    let validated = seampact_validate::validate_workspace(workspace)?;

    Ok(StageAnswer::Ported(Validated {
        workspace: validated.workspace,
        apis: validated
            .apis
            .into_iter()
            .map(|entry| (entry.api, entry.diagnostics))
            .collect(),
    }))
}

/// The relay order of the workspace's apis.
///
/// # Errors
///
/// An [`InternalError`] from the relay order.
pub fn workspace_relay_order(
    workspace: &RawWorkspace,
) -> Result<StageAnswer<RelayOrder>, InternalError> {
    relay::workspace_relay_order(workspace).map(StageAnswer::Ported)
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
    imports: &IndexMap<String, ImportedIr>,
) -> Result<StageAnswer<Vec<(String, Diagnostic)>>, InternalError> {
    match seampact_pass_link::run(drafts, workspace, imports) {
        Ok(reported) => Ok(StageAnswer::Ported(reported)),
        Err(PassError::NotPortedYet { .. }) => Ok(StageAnswer::NotPorted),
        Err(PassError::Internal(internal)) => Err(internal),
    }
}

/// Finalizes one api's complete draft, which it takes by value: its parts move into the IR.
///
/// `files` locates the api's spans for the source map.
///
/// # Errors
///
/// An [`InternalError`] when a span is outside its file or the draft builds an invalid IR.
pub fn finalize_api(
    draft: DraftIr,
    raw: &RawApi,
    files: &SourceFiles,
) -> Result<FinalizeRun, InternalError> {
    let locations = files.locations(&raw.locations)?;
    let mut context = FinalizeContext::new(raw, &locations, &LoadPackFiles);
    let finalized = finalize(draft, &mut context)?;

    Ok(FinalizeRun {
        diagnostics: context.into_diagnostics(),
        finalized,
    })
}

/// The pack file paths of the load stage, which finalize does not depend on.
struct LoadPackFiles;

impl PackFiles for LoadPackFiles {
    fn parts<'file>(&self, file: &'file str) -> Option<PackFileParts<'file>> {
        pack_file_parts(file).map(|parts| PackFileParts {
            name: parts.name,
            inside: parts.inside,
        })
    }

    fn vendored_file(&self, name: &str, version: &str, inside: &str) -> String {
        pack_vendored_file(name, version, inside)
    }

    fn is_inside_workspace(&self, file: &str) -> bool {
        is_inside(".", file)
    }
}
