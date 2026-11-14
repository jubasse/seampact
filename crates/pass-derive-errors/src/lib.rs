//! The `derive.errors` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/derive/errors`.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod attached;
mod bindings;
mod examples;
mod natures;
mod not_ported;
mod operations;
mod read;
mod registry;
mod relays;
mod report;
mod retry_param;
mod role_param_fit;
mod role_param_types;
mod role_params;
mod sensitive_params;
mod triggers;

use seampact_diagnostics::RuleId;
use seampact_pipeline::{DeriveErrorsOutput, DraftIr, HalfContext, PassError, TreeSchemaService};

use crate::not_ported::not_ported_yet;

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[];

/// Runs `derive.errors` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    _draft: &DraftIr,
    _context: &mut HalfContext<'_>,
    _schemas: &dyn TreeSchemaService,
) -> Result<DeriveErrorsOutput, PassError> {
    Err(not_ported_yet("deriveErrorsPass.run"))
}
