import type { Param } from "@seampact/spec/ir";

// The one derived header param that is part of the request: it selects the body variant of a header-tagged union.
const UNION_TAG_DERIVATION = "union.headerTag";

/**
 * The header params an idempotency fingerprint digests, lower case: the ones the author declared and a union tag.
 * Any other header param the compiler derives (a trace id, a deadline, the key, a CSRF token) changes on a retry, so
 * it is left out (ADR 0012).
 */
export function fingerprintHeaderNames(headerParams: readonly Param[]): string[] {
  return headerParams
    .filter(
      (param) =>
        param.derivedFrom === undefined || param.derivedFrom.derivation === UNION_TAG_DERIVATION,
    )
    .map((param) => param.name.toLowerCase());
}
