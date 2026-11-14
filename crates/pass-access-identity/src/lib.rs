//! The `access.identity` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/access/identity`.

#![allow(
    dead_code,
    reason = "functions reached only by stubs until the half's last brief"
)]

mod access;
mod bindings;
mod csrf;
mod headers;
mod identities;
mod known;
mod not_ported;
mod operations;
mod params;
mod pass;
mod principal;
mod read;
mod report;
mod schema_use;
mod schemes;
mod service;
mod signed;
mod source;

use seampact_diagnostics::RuleId;
use seampact_pipeline::{AccessIdentityOutput, DraftIr, HalfContext, PassError, TreeSchemaService};

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    RuleId::from_static("seampact/access/scheme-member"),
    RuleId::from_static("seampact/access/scheme-reference"),
    RuleId::from_static("seampact/access/scheme-kind"),
    RuleId::from_static("seampact/access/signature-verify"),
    RuleId::from_static("seampact/access/signature-template"),
    RuleId::from_static("seampact/access/signature-tolerance"),
    RuleId::from_static("seampact/access/signature-key"),
    RuleId::from_static("seampact/access/identity-member"),
    RuleId::from_static("seampact/access/principal"),
    RuleId::from_static("seampact/access/principal-field"),
    RuleId::from_static("seampact/access/header-declaration"),
    RuleId::from_static("seampact/access/header-use"),
    RuleId::from_static("seampact/access/deny-by-default"),
    RuleId::from_static("seampact/access/identity-reference"),
    RuleId::from_static("seampact/access/optional-identity"),
    RuleId::from_static("seampact/access/access-schemes"),
    RuleId::from_static("seampact/access/signed-access"),
    RuleId::from_static("seampact/access/signature-key-source"),
    RuleId::from_static("seampact/access/scheme-query-field"),
    RuleId::from_static("seampact/access/csrf-header"),
    RuleId::from_static("seampact/access/service-identity"),
    RuleId::from_static("seampact/access/service-access"),
    RuleId::from_static("seampact/access/binding-source"),
    RuleId::from_static("seampact/access/binding-conflict"),
    RuleId::from_static("seampact/access/public-identity"),
];

/// Runs `access.identity` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError::NotPortedYet`] when the run reaches a function not ported yet, else
/// [`PassError::Internal`] for a bug.
pub fn run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<AccessIdentityOutput, PassError> {
    pass::access_identity_pass_run(draft, context, schemas)
}
