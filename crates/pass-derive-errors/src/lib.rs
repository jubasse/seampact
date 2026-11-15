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
mod pass;
mod read;
mod registry;
mod relays;
mod report;
mod retry_param;
mod role_param_fit;
mod role_param_types;
mod role_params;
mod sensitive_params;
#[cfg(test)]
mod tests;
mod triggers;

use seampact_diagnostics::RuleId;
use seampact_pipeline::{DeriveErrorsOutput, DraftIr, HalfContext, PassError, TreeSchemaService};

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    RuleId::from_static("seampact/derive/error-redefined"),
    RuleId::from_static("seampact/derive/error-unknown"),
    RuleId::from_static("seampact/derive/error-pattern"),
    RuleId::from_static("seampact/derive/error-nature"),
    RuleId::from_static("seampact/derive/error-params"),
    RuleId::from_static("seampact/derive/error-example"),
    RuleId::from_static("seampact/derive/error-default"),
    RuleId::from_static("seampact/derive/nature-base"),
    RuleId::from_static("seampact/derive/role-code"),
    RuleId::from_static("seampact/derive/role-datum"),
    RuleId::from_static("seampact/derive/role-param"),
    RuleId::from_static("seampact/derive/role-param-required"),
    RuleId::from_static("seampact/derive/role-param-type"),
    RuleId::from_static("seampact/derive/role-template"),
    RuleId::from_static("seampact/derive/retry-param"),
    RuleId::from_static("seampact/derive/relay-declaration"),
    RuleId::from_static("seampact/derive/cache-sensitive-elsewhere"),
];

/// Runs `derive.errors` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<DeriveErrorsOutput, PassError> {
    pass::derive_errors_pass_run(draft, context, schemas)
}
