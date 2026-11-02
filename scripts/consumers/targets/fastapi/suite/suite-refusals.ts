// The cases the FastAPI consumer does not run, by case id, with the reason. The consumer serves the operations this
// release of the target covers (health, getChannel and getDraft of the tasks api); a case of another operation waits
// for the release that serves it.
const OPERATION_NOT_SERVED =
  "Its operation is not served yet: the FastAPI consumer serves health, getChannel and getDraft until fastapi-3 and fastapi-4.";
const NEAR_MISS_NOT_SERVED =
  "Its path is a near miss of getTask, which the FastAPI consumer does not serve until fastapi-3.";
const SERVICE_API_NOT_SERVED = "The tasksService api is not served until fastapi-4.";
const NO_DECIDER_NEEDED =
  "No operation the FastAPI consumer serves declares a right or a rule, so it binds no decider until fastapi-3.";

export const FASTAPI_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "bad-webhook-signature": OPERATION_NOT_SERVED,
  "batch-body-limit": OPERATION_NOT_SERVED,
  "batch-read-without-csrf-or-key": OPERATION_NOT_SERVED,
  "bearer-beside-cookie-skips-csrf": OPERATION_NOT_SERVED,
  "body-above-limit": OPERATION_NOT_SERVED,
  "cache-family-headers": OPERATION_NOT_SERVED,
  "cookie-write-without-csrf-header": OPERATION_NOT_SERVED,
  "delete-answers-body": OPERATION_NOT_SERVED,
  "denied-requirement-short-circuits": OPERATION_NOT_SERVED,
  "empty-title-names-pointer-and-rule": OPERATION_NOT_SERVED,
  "etag-and-not-modified": OPERATION_NOT_SERVED,
  "every-operation-succeeds": OPERATION_NOT_SERVED,
  "handler-declared-error-answered": OPERATION_NOT_SERVED,
  "head-runs-get-without-body": OPERATION_NOT_SERVED,
  "idempotency-key-missing": OPERATION_NOT_SERVED,
  "idempotency-key-reused": OPERATION_NOT_SERVED,
  "idempotent-replay": OPERATION_NOT_SERVED,
  "limit-above-max-refused": OPERATION_NOT_SERVED,
  "malformed-json-answers-bad-request": OPERATION_NOT_SERVED,
  "member-action-version-conflict": OPERATION_NOT_SERVED,
  "opaque-null-refused-when-not-nullable": OPERATION_NOT_SERVED,
  "overridden-right-reaches-its-own-hook": OPERATION_NOT_SERVED,
  "page-links-next-page": OPERATION_NOT_SERVED,
  "plus-json-media-type-unsupported": OPERATION_NOT_SERVED,
  "query-number-decoding": OPERATION_NOT_SERVED,
  "recent-auth-denied": OPERATION_NOT_SERVED,
  "recent-auth-proof-required": OPERATION_NOT_SERVED,
  "refusal-before-handler-not-stored": OPERATION_NOT_SERVED,
  "requirements-run-in-declared-order": OPERATION_NOT_SERVED,
  "restricted-input-field-accepted-with-right": OPERATION_NOT_SERVED,
  "restricted-input-field-refused-without-right": OPERATION_NOT_SERVED,
  "restricted-output-field-absent-without-right": OPERATION_NOT_SERVED,
  "restricted-output-field-present-with-right": OPERATION_NOT_SERVED,
  "right-denied-answers-forbidden": OPERATION_NOT_SERVED,
  "scope-non-member-denied": OPERATION_NOT_SERVED,
  "signed-webhook-without-csrf-or-key": OPERATION_NOT_SERVED,
  "stale-body-version-conflict": OPERATION_NOT_SERVED,
  "stale-webhook-signature": OPERATION_NOT_SERVED,
  "throttled-with-retry-after": OPERATION_NOT_SERVED,
  "unauthenticated-without-credentials": OPERATION_NOT_SERVED,
  "undeclared-member-stripped-from-page-items": OPERATION_NOT_SERVED,
  "undeclared-sort-key-on-list-tasks": OPERATION_NOT_SERVED,
  "unknown-body-key-refused": OPERATION_NOT_SERVED,
  "unknown-enum-value-refused": OPERATION_NOT_SERVED,
  "not-found-doubled-slash": NEAR_MISS_NOT_SERVED,
  "not-found-percent-encoded-segment": NEAR_MISS_NOT_SERVED,
  "not-found-trailing-slash": NEAR_MISS_NOT_SERVED,
  "wrong-method-on-tasks-path": NEAR_MISS_NOT_SERVED,
  "caller-service-not-listed-forbidden": SERVICE_API_NOT_SERVED,
  "deadline-missing-refused": SERVICE_API_NOT_SERVED,
  "deadline-passed-answers-timeout": SERVICE_API_NOT_SERVED,
  "issues-reported-together": SERVICE_API_NOT_SERVED,
  "relay-sends-restricted-fields": SERVICE_API_NOT_SERVED,
  "wrong-method-on-tasks-service-path": SERVICE_API_NOT_SERVED,
  "missing-decider-fails-boot": NO_DECIDER_NEEDED,
};
