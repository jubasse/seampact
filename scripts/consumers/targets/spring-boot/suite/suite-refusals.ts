// The cases the Spring Boot consumer does not run yet, by case id, with the release of the target that brings each:
// the consumer keeps the reference's core-path operations until spring-3 widens its filter (ADR 0022 "Delivery").
const CREATE_TASK =
  "Calls createTask, whose idempotency replay, throttle and restricted input fields come with spring-3.";
const LIST_TASKS = "Calls listTasks, whose paging comes with spring-3.";
const PAYMENTS = "Calls the signed payments route, which comes with spring-3.";
const PREFERENCES =
  "Calls the preferences operations, whose cache headers and idempotency replay come with spring-3.";
const UPDATE_TASK =
  "Calls a task write with a version token, whose concurrency check comes with spring-3.";
const PURGE_TASK = "Calls purgeTask, whose rule proofs come with spring-3.";

export const SPRING_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "bad-webhook-signature": PAYMENTS,
  "bearer-beside-cookie-skips-csrf": CREATE_TASK,
  "body-above-limit": CREATE_TASK,
  "cache-family-headers": PREFERENCES,
  "cookie-write-without-csrf-header": CREATE_TASK,
  "delete-answers-body": "Calls deleteDraft, whose idempotency replay comes with spring-3.",
  "denied-requirement-short-circuits": CREATE_TASK,
  "empty-title-names-pointer-and-rule": CREATE_TASK,
  "etag-and-not-modified": PREFERENCES,
  "every-operation-succeeds":
    "Calls every reference operation; those outside the core path come with spring-3.",
  "idempotency-key-missing": CREATE_TASK,
  "idempotency-key-reused": CREATE_TASK,
  "idempotent-replay": CREATE_TASK,
  "limit-above-max-refused": LIST_TASKS,
  "malformed-json-answers-bad-request": CREATE_TASK,
  "member-action-version-conflict": UPDATE_TASK,
  "missing-decider-fails-boot":
    "Names the 'roles' rule, which only createTask uses; createTask comes with spring-3.",
  "overridden-right-reaches-its-own-hook": CREATE_TASK,
  "page-links-next-page": LIST_TASKS,
  "plus-json-media-type-unsupported": PREFERENCES,
  "query-number-decoding": LIST_TASKS,
  "recent-auth-denied": PURGE_TASK,
  "recent-auth-proof-required": PURGE_TASK,
  "refusal-before-handler-not-stored": CREATE_TASK,
  "requirements-run-in-declared-order": CREATE_TASK,
  "restricted-input-field-accepted-with-right": CREATE_TASK,
  "restricted-input-field-refused-without-right": CREATE_TASK,
  "right-denied-answers-forbidden": CREATE_TASK,
  "signed-webhook-without-csrf-or-key": PAYMENTS,
  "stale-body-version-conflict": UPDATE_TASK,
  "stale-webhook-signature": PAYMENTS,
  "throttled-with-retry-after": CREATE_TASK,
  "undeclared-member-stripped-from-page-items": LIST_TASKS,
  "undeclared-sort-key-on-list-tasks": LIST_TASKS,
  "unknown-body-key-refused": CREATE_TASK,
  "unknown-enum-value-refused": UPDATE_TASK,
};
