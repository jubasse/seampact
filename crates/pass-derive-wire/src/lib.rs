//! The `derive.wire` half (ADR 0006 section 2), ported from
//! `packages/core/compiler/src/passes/derive/wire`.

mod api_wire;
mod bodies;
mod body_limit;
mod buckets;
mod cache;
mod concurrency;
mod credentials;
mod header_tag;
mod idempotency;
mod identity_headers;
mod lifecycle;
mod paging;
mod params;
mod pass;
mod relayed;
mod report;
mod routes;
mod sensitive;
#[cfg(test)]
mod tests;
mod unknown_keys;

use seampact_diagnostics::RuleId;
use seampact_pipeline::{DeriveWireOutput, DraftIr, HalfContext, PassError, TreeSchemaService};

use crate::report::DeriveWireRule;

/// Every rule id the half reports, read by the oracle's rule id registry.
pub const RULE_IDS: &[RuleId] = &[
    DeriveWireRule::IdempotencyConvention.rule_id(),
    DeriveWireRule::IdempotencyExemptUnused.rule_id(),
    DeriveWireRule::DerivedNameCollision.rule_id(),
    DeriveWireRule::CacheMethod.rule_id(),
    DeriveWireRule::CacheFamily.rule_id(),
    DeriveWireRule::CacheFreshness.rule_id(),
    DeriveWireRule::CacheSensitive.rule_id(),
    DeriveWireRule::CacheSensitiveElsewhere.rule_id(),
    DeriveWireRule::BucketLimits.rule_id(),
];

/// Runs `derive.wire` over the draft, reading schemas through the service `tree.schemas` built.
///
/// # Errors
///
/// [`PassError`] when a schema service call fails, or for a bug.
pub fn run(
    draft: &DraftIr,
    context: &mut HalfContext<'_>,
    schemas: &dyn TreeSchemaService,
) -> Result<DeriveWireOutput, PassError> {
    pass::derive_wire_pass_run(draft, context, schemas)
}
