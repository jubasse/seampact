//! The `tree.schemas` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/tree/schemas`: the schema catalogues and the schema service
//! every later half reads.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod not_ported;

use seampact_diagnostics::RuleId;
use seampact_pipeline::{DraftIr, HalfContext, PassError, TreeSchemasOutput};

use crate::not_ported::not_ported_yet;

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];

/// Runs `tree.schemas` over the draft: its catalogues, and the service that owns everything it
/// reads (it copies from the draft and the context, never borrows them).
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    _draft: &DraftIr,
    _context: &mut HalfContext<'_>,
) -> Result<TreeSchemasOutput, PassError> {
    Err(not_ported_yet("treeSchemasPass.run"))
}
