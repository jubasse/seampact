import type { Param } from "@seampact/spec/ir";

/**
 * The header params an idempotency fingerprint digests, lower case: the ones the author declared. A header param the
 * compiler derives (a trace id, a deadline, the key, a CSRF token) changes on a retry, so it is left out (ADR 0012).
 */
export function fingerprintHeaderNames(headerParams: readonly Param[]): string[] {
  return headerParams
    .filter((param) => param.derivedFrom === undefined)
    .map((param) => param.name.toLowerCase());
}
