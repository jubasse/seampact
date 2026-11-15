//! Bucket limits (ADR 0006 section 3, derive checks; grammar 09, buckets): a bucket may leave its
//! `limit` or `window` for the server to bind, and the compiler then warns once per bucket, at its
//! declaration.

use seampact_diagnostics::{InternalError, quote_text};

use crate::report::{DeriveWireProblem, DeriveWireRule};
use crate::routes::DeriveWireScope;

/// Warns about each bucket that leaves its limit or its window unset.
///
/// # Errors
///
/// An internal error when a bucket's declaration has no authored origin.
pub(crate) fn derive_wire_bucket_limits(
    scope: &mut DeriveWireScope<'_, '_, '_>,
) -> Result<(), InternalError> {
    let draft = scope.draft;

    for bucket in draft.buckets.values() {
        let mut unset = Vec::new();

        if bucket.limit.is_none() {
            unset.push("limit");
        }

        if bucket.window_ms.is_none() {
            unset.push("window");
        }

        if unset.is_empty() {
            continue;
        }

        let members = unset.join(" and ");
        let pronoun = if unset.len() == 1 { "it" } else { "them" };
        let id = quote_text(bucket.id.as_str());

        scope.reporter().warning(DeriveWireProblem {
            rule: DeriveWireRule::BucketLimits,
            message: format!("The bucket {id} sets no {members}, so the server binds {pronoun}."),
            fix: format!("Set {members} on the bucket {id}, or bind {pronoun} in the server."),
            pointer: bucket.origin.pointer.clone(),
            related: Vec::new(),
        })?;
    }

    Ok(())
}
