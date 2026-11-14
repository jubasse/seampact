//! The `tree.schemas` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/tree/schemas`: the schema catalogues and the schema service
//! every later half reads.

#![allow(
    dead_code,
    unused_variables,
    clippy::unused_self,
    clippy::needless_pass_by_value,
    clippy::trivially_copy_pass_by_ref,
    clippy::ptr_arg,
    reason = "functions reached only by stubs, which read none of their parameters, until the half's last brief"
)]

mod code_params;
mod compile;
mod core;
mod decimal;
mod derived;
mod directions;
mod enums;
mod example_check;
mod extensions;
mod not_ported;
mod operations;
mod pass;
mod pattern;
mod positions;
mod property;
mod query_wire;
mod raw;
mod relays;
mod scalars;

use seampact_diagnostics::RuleId;
use seampact_pipeline::{DraftIr, HalfContext, PassError, TreeSchemasOutput};

use crate::not_ported::not_ported_yet;

pub use crate::pattern::{
    TreeSchemasPatternResult, tree_schemas_escape_pattern_literal, tree_schemas_normalize_pattern,
};

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    RuleId::from_static("seampact/tree/all-of-member"),
    RuleId::from_static("seampact/tree/all-of-property"),
    RuleId::from_static("seampact/tree/annotation-position"),
    RuleId::from_static("seampact/tree/batch-ids"),
    RuleId::from_static("seampact/tree/concurrency-field"),
    RuleId::from_static("seampact/tree/concurrency-version"),
    RuleId::from_static("seampact/tree/derived-field"),
    RuleId::from_static("seampact/tree/derived-overlay"),
    RuleId::from_static("seampact/tree/derived-source"),
    RuleId::from_static("seampact/tree/enum-code-name"),
    RuleId::from_static("seampact/tree/enum-cycle"),
    RuleId::from_static("seampact/tree/enum-fallback"),
    RuleId::from_static("seampact/tree/enum-narrowing"),
    RuleId::from_static("seampact/tree/enum-reason"),
    RuleId::from_static("seampact/tree/enum-unknown"),
    RuleId::from_static("seampact/tree/enum-values"),
    RuleId::from_static("seampact/tree/extension-place"),
    RuleId::from_static("seampact/tree/extension-unknown"),
    RuleId::from_static("seampact/tree/fields-schema"),
    RuleId::from_static("seampact/tree/format-refinement"),
    RuleId::from_static("seampact/tree/format-type"),
    RuleId::from_static("seampact/tree/format-unknown"),
    RuleId::from_static("seampact/tree/map-keys"),
    RuleId::from_static("seampact/tree/mark-position"),
    RuleId::from_static("seampact/tree/name-collision"),
    RuleId::from_static("seampact/tree/name-segments"),
    RuleId::from_static("seampact/tree/object-empty"),
    RuleId::from_static("seampact/tree/pattern"),
    RuleId::from_static("seampact/tree/query-map"),
    RuleId::from_static("seampact/tree/refinement-precision"),
    RuleId::from_static("seampact/tree/refinement-range"),
    RuleId::from_static("seampact/tree/refinement-type"),
    RuleId::from_static("seampact/tree/relay-declaration"),
    RuleId::from_static("seampact/tree/relay-unknown"),
    RuleId::from_static("seampact/tree/required-property"),
    RuleId::from_static("seampact/tree/required-unknown"),
    RuleId::from_static("seampact/tree/scalar-name"),
    RuleId::from_static("seampact/tree/schema-content"),
    RuleId::from_static("seampact/tree/schema-cycle"),
    RuleId::from_static("seampact/tree/schema-inline"),
    RuleId::from_static("seampact/tree/schema-keyword"),
    RuleId::from_static("seampact/tree/schema-reserved"),
    RuleId::from_static("seampact/tree/schema-shape"),
    RuleId::from_static("seampact/tree/schema-unknown"),
    RuleId::from_static("seampact/tree/union-discriminator"),
    RuleId::from_static("seampact/tree/union-header"),
    RuleId::from_static("seampact/tree/union-tag"),
    RuleId::from_static("seampact/tree/union-variant"),
    RuleId::from_static("seampact/tree/unknown-keys"),
    RuleId::from_static("seampact/tree/example-value"),
    RuleId::from_static("seampact/tree/default-value"),
    RuleId::from_static("seampact/tree/extension-value"),
];

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
