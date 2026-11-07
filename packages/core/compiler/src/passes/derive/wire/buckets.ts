import { quote } from "../../../validate/diagnostics.js";
import type { DeriveWireScope } from "./routes.js";

// Bucket limits (ADR 0006 section 3, derive checks; grammar 09, buckets): a bucket may leave its `limit` or
// `window` for the server to bind, and the compiler then warns once per bucket, at its declaration.

/** Warns about each bucket that leaves its limit or its window unset. */
export function deriveWireBucketLimits(scope: DeriveWireScope): void {
  for (const bucket of Object.values(scope.draft.buckets)) {
    const unset = [
      ...(bucket.limit === undefined ? ["limit"] : []),
      ...(bucket.windowMs === undefined ? ["window"] : []),
    ];

    if (unset.length === 0) continue;

    const members = unset.join(" and ");
    const pronoun = unset.length === 1 ? "it" : "them";

    scope.reporter.warning({
      rule: "bucket-limits",
      message: `The bucket ${quote(bucket.id)} sets no ${members}, so the server binds ${pronoun}.`,
      fix: `Set ${members} on the bucket ${quote(bucket.id)}, or bind ${pronoun} in the server.`,
      pointer: bucket.origin.pointer,
    });
  }
}
