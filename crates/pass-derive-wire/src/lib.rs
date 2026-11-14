//! The `derive.wire` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/derive/wire`.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod not_ported;

use seampact_diagnostics::RuleId;
use seampact_pipeline::{DeriveWireOutput, DraftIr, HalfContext, PassError, TreeSchemaService};

use crate::not_ported::not_ported_yet;

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];

/// Runs `derive.wire` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    _draft: &DraftIr,
    _context: &mut HalfContext<'_>,
    _schemas: &dyn TreeSchemaService,
) -> Result<DeriveWireOutput, PassError> {
    Err(not_ported_yet("deriveWirePass.run"))
}
