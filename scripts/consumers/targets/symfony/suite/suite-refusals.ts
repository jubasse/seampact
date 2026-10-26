// The cases the Symfony consumer does not run yet, by case id, with the reason: the consumer serves the core
// operations of the tasks api, so a case calling another operation waits for the PR that generates its forms
// (ADR 0024 "Delivery").
const IDEMPOTENCY = "idempotency and the response headers it derives, which symfony-3 generates";
const PAGING = "paging and its sort parameter, which symfony-3 generates";
const CACHE = "cache and ETag headers, which symfony-3 generates";
const SIGNED = "a signed raw body and an opaque value, which symfony-3 generates";
const SERVICE_API = "the tasksService api, whose deadline budgets and relays symfony-3 generates";

// The form that keeps each operation out of the consumer, by `<api>.<operationId>`.
const WAITING_OPERATIONS = {
  "tasks.createTask": IDEMPOTENCY,
  "tasks.updateTask": IDEMPOTENCY,
  "tasks.archiveTask": IDEMPOTENCY,
  "tasks.purgeTask": IDEMPOTENCY,
  "tasks.deleteDraft": IDEMPOTENCY,
  "tasks.updatePreferences": IDEMPOTENCY,
  "tasks.listTasks": PAGING,
  "tasks.getPreferences": CACHE,
  "tasks.payments": SIGNED,
  "tasksService.getTask": SERVICE_API,
} as const;

type WaitingOperation = keyof typeof WAITING_OPERATIONS;

function calls(operation: WaitingOperation): string {
  return `Calls ${operation}, which carries ${WAITING_OPERATIONS[operation]}.`;
}

export const SYMFONY_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "bad-webhook-signature": calls("tasks.payments"),
  "bearer-beside-cookie-skips-csrf": calls("tasks.createTask"),
  "body-above-limit": calls("tasks.createTask"),
  "cache-family-headers": calls("tasks.getPreferences"),
  "caller-service-not-listed-forbidden": calls("tasksService.getTask"),
  "cookie-write-without-csrf-header": calls("tasks.createTask"),
  "deadline-missing-refused": calls("tasksService.getTask"),
  "deadline-passed-answers-timeout": calls("tasksService.getTask"),
  "delete-answers-body": calls("tasks.deleteDraft"),
  "denied-requirement-short-circuits": calls("tasks.createTask"),
  "empty-title-names-pointer-and-rule": calls("tasks.createTask"),
  "etag-and-not-modified": calls("tasks.getPreferences"),
  "every-operation-succeeds": calls("tasks.listTasks"),
  "idempotency-key-missing": calls("tasks.createTask"),
  "idempotency-key-reused": calls("tasks.createTask"),
  "idempotent-replay": calls("tasks.createTask"),
  "issues-reported-together": calls("tasksService.getTask"),
  "limit-above-max-refused": calls("tasks.listTasks"),
  "malformed-json-answers-bad-request": calls("tasks.createTask"),
  "member-action-version-conflict": calls("tasks.archiveTask"),
  "overridden-right-reaches-its-own-hook": calls("tasks.updateTask"),
  "page-links-next-page": calls("tasks.listTasks"),
  "plus-json-media-type-unsupported": calls("tasks.updatePreferences"),
  "query-number-decoding": calls("tasks.listTasks"),
  "recent-auth-denied": calls("tasks.purgeTask"),
  "recent-auth-proof-required": calls("tasks.purgeTask"),
  "refusal-before-handler-not-stored": calls("tasks.createTask"),
  "relay-sends-restricted-fields": calls("tasksService.getTask"),
  "requirements-run-in-declared-order": calls("tasks.createTask"),
  "restricted-input-field-accepted-with-right": calls("tasks.createTask"),
  "restricted-input-field-refused-without-right": calls("tasks.createTask"),
  "right-denied-answers-forbidden": calls("tasks.createTask"),
  "scope-non-member-denied": calls("tasks.listTasks"),
  "signed-webhook-without-csrf-or-key": calls("tasks.payments"),
  "stale-body-version-conflict": calls("tasks.updateTask"),
  "stale-webhook-signature": calls("tasks.payments"),
  "throttled-with-retry-after": calls("tasks.createTask"),
  "undeclared-member-stripped-from-page-items": calls("tasks.listTasks"),
  "undeclared-sort-key-on-list-tasks": calls("tasks.listTasks"),
  "unknown-body-key-refused": calls("tasks.createTask"),
  "unknown-enum-value-refused": calls("tasks.updateTask"),
  "wrong-method-on-tasks-service-path": `Its 404 comes from ${SERVICE_API}.`,
  "missing-decider-fails-boot":
    "Its diagnostic names the 'roles' right, which only operations that symfony-3 generates require.",
};
