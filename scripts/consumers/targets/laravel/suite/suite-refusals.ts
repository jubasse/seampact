// The cases the Laravel consumer does not run yet, by case id, with the reason: a case calling an operation the
// consumer does not serve yet waits for the PR that generates its forms (ADR 0023 "Delivery").
const CACHE = "cache and ETag headers, which laravel-3 generates";
const SIGNED = "a signed raw body and an opaque value, which laravel-3 generates";
const SERVICE_API = "the tasksService api, whose deadline budgets and relays laravel-3 generates";

// The form that keeps each operation out of the consumer, by `<api>.<operationId>`.
const WAITING_OPERATIONS = {
  "tasks.getPreferences": CACHE,
  "tasks.payments": SIGNED,
  "tasksService.getTask": SERVICE_API,
} as const;

type WaitingOperation = keyof typeof WAITING_OPERATIONS;

function calls(operation: WaitingOperation): string {
  return `Calls ${operation}, which carries ${WAITING_OPERATIONS[operation]}.`;
}

export const LARAVEL_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "every-operation-succeeds": calls("tasks.getPreferences"),
  "bad-webhook-signature": calls("tasks.payments"),
  "cache-family-headers": calls("tasks.getPreferences"),
  "caller-service-not-listed-forbidden": calls("tasksService.getTask"),
  "deadline-missing-refused": calls("tasksService.getTask"),
  "deadline-passed-answers-timeout": calls("tasksService.getTask"),
  "etag-and-not-modified": calls("tasks.getPreferences"),
  "issues-reported-together": calls("tasksService.getTask"),
  "relay-sends-restricted-fields": calls("tasksService.getTask"),
  "signed-webhook-without-csrf-or-key": calls("tasks.payments"),
  "stale-webhook-signature": calls("tasks.payments"),
  "wrong-method-on-tasks-service-path": `Its 404 comes from ${SERVICE_API}.`,
};
