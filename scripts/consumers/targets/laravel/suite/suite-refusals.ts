// The cases the Laravel consumer does not run yet, by case id, with the reason: a case calling an operation the
// consumer does not serve yet waits for the PR that generates its forms (ADR 0023 "Delivery").
const PAGING = "paging and its sort parameter, which laravel-3 generates";
const CACHE = "cache and ETag headers, which laravel-3 generates";
const SIGNED = "a signed raw body and an opaque value, which laravel-3 generates";
const SERVICE_API = "the tasksService api, whose deadline budgets and relays laravel-3 generates";

// The form that keeps each operation out of the consumer, by `<api>.<operationId>`.
const WAITING_OPERATIONS = {
  "tasks.listTasks": PAGING,
  "tasks.getPreferences": CACHE,
  "tasks.payments": SIGNED,
  "tasksService.getTask": SERVICE_API,
} as const;

type WaitingOperation = keyof typeof WAITING_OPERATIONS;

function calls(operation: WaitingOperation): string {
  return `Calls ${operation}, which carries ${WAITING_OPERATIONS[operation]}.`;
}

export const LARAVEL_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "bad-webhook-signature": calls("tasks.payments"),
  "cache-family-headers": calls("tasks.getPreferences"),
  "caller-service-not-listed-forbidden": calls("tasksService.getTask"),
  "deadline-missing-refused": calls("tasksService.getTask"),
  "deadline-passed-answers-timeout": calls("tasksService.getTask"),
  "etag-and-not-modified": calls("tasks.getPreferences"),
  "every-operation-succeeds": calls("tasks.listTasks"),
  "issues-reported-together": calls("tasksService.getTask"),
  "limit-above-max-refused": calls("tasks.listTasks"),
  "page-links-next-page": calls("tasks.listTasks"),
  "query-number-decoding": calls("tasks.listTasks"),
  "relay-sends-restricted-fields": calls("tasksService.getTask"),
  "scope-non-member-denied": calls("tasks.listTasks"),
  "signed-webhook-without-csrf-or-key": calls("tasks.payments"),
  "stale-webhook-signature": calls("tasks.payments"),
  "undeclared-member-stripped-from-page-items": calls("tasks.listTasks"),
  "undeclared-sort-key-on-list-tasks": calls("tasks.listTasks"),
  "wrong-method-on-tasks-service-path": `Its 404 comes from ${SERVICE_API}.`,
};
