//! The link pass (ADR 0006 section 3), ported from `packages/core/compiler/src/passes/link`: checks
//! over the derived draft of every api, reported as diagnostics only.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod not_ported;

use indexmap::IndexMap;
use seampact_authoring::RawWorkspace;
use seampact_diagnostics::{Diagnostic, RuleId};
use seampact_ir::ContractIr;
use seampact_pipeline::{DraftIr, PassError};

use crate::not_ported::not_ported_yet;

/// Every rule id the pass reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];

/// Links every api's derived draft, in workspace order, against the workspace and the imported
/// contracts; answers each diagnostic under the api it belongs to.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    _drafts: &IndexMap<String, DraftIr>,
    _workspace: &RawWorkspace,
    _imports: &IndexMap<String, ContractIr>,
) -> Result<Vec<(String, Diagnostic)>, PassError> {
    Err(not_ported_yet("linkPass.run"))
}
