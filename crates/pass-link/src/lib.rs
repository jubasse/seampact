//! The link pass (ADR 0006 section 3), ported from `packages/core/compiler/src/passes/link`: checks
//! over the derived draft of every api, reported as diagnostics only.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod not_ported;
mod origin;
mod relays;

use indexmap::IndexMap;
use seampact_authoring::RawWorkspace;
use seampact_diagnostics::{Diagnostic, RuleId};
use seampact_ir::ContractIr;
use seampact_pipeline::{DraftIr, PassError};

pub use origin::diagnostic_origin_of;
pub use relays::LINK_GATEWAY_DERIVATIONS;
use relays::{RELAY_SUPERSET_RULE_ID, link_relay_superset};

/// Every rule id the pass reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[RELAY_SUPERSET_RULE_ID];

/// Links every api's derived draft, in workspace order, against the workspace and the imported
/// contracts; answers each diagnostic under the api it belongs to.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    drafts: &IndexMap<String, DraftIr>,
    _workspace: &RawWorkspace,
    imports: &IndexMap<String, ContractIr>,
) -> Result<Vec<(String, Diagnostic)>, PassError> {
    link_relay_superset(drafts, imports)
}
