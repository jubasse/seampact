// The cases beyond the shared ones the stub refuses, by case id. The stub answers the reference operations as the
// contract declares them for the packed installs and the fetch client test; it runs no generated boundary, hooks,
// limits or restricted fields, so each case that needs one is refused here, and each server target proves it.
const STUB_REASON =
  "the stub is a hand-written server with no generated boundary, so it does not implement what this case checks";

export const TARGET_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "batch-body-limit": STUB_REASON,
  "batch-read-without-csrf-or-key": STUB_REASON,
  "body-above-limit": STUB_REASON,
  "cache-family-headers": STUB_REASON,
  "caller-service-not-listed-forbidden": STUB_REASON,
  "deadline-passed-answers-timeout": STUB_REASON,
  "denied-requirement-short-circuits": STUB_REASON,
  "handler-declared-error-answered": STUB_REASON,
  "handler-exception-answers-internal-error": STUB_REASON,
  "idempotency-key-missing": STUB_REASON,
  "issues-reported-together": STUB_REASON,
  "limit-above-max-refused": STUB_REASON,
  "malformed-json-answers-bad-request": STUB_REASON,
  "member-action-version-conflict": STUB_REASON,
  "query-number-decoding": STUB_REASON,
  "recent-auth-denied": STUB_REASON,
  "recent-auth-proof-required": STUB_REASON,
  "refusal-before-handler-not-stored": STUB_REASON,
  "relay-sends-restricted-fields": STUB_REASON,
  "requirements-run-in-declared-order": STUB_REASON,
  "restricted-input-field-refused-without-right": STUB_REASON,
  "restricted-output-field-absent-without-right": STUB_REASON,
  "restricted-output-field-present-with-right": STUB_REASON,
  "right-denied-answers-forbidden": STUB_REASON,
  "scope-non-member-denied": STUB_REASON,
  "stale-body-version-conflict": STUB_REASON,
  "undeclared-handler-error-answers-internal-error": STUB_REASON,
  "undeclared-member-stripped-from-page-items": STUB_REASON,
  "undeclared-status-answers-internal-error": STUB_REASON,
  "unknown-body-key-refused": STUB_REASON,
  "unknown-enum-value-refused": STUB_REASON,
};
