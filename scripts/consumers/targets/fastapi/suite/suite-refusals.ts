// The cases the FastAPI consumer does not run, by case id, with the reason. The consumer serves every operation of the
// tasks api; the tasksService api, with its relays and deadlines, waits for fastapi-4.
const SERVICE_API_NOT_SERVED = "The tasksService api is not served until fastapi-4.";

const SERVICE_STEP_NOT_SERVED =
  "Its steps end with the tasksService api, which is not served until fastapi-4; every tasks operation answers in the other cases.";

export const FASTAPI_SUITE_REFUSALS: Readonly<Record<string, string>> = {
  "every-operation-succeeds": SERVICE_STEP_NOT_SERVED,
  "caller-service-not-listed-forbidden": SERVICE_API_NOT_SERVED,
  "deadline-missing-refused": SERVICE_API_NOT_SERVED,
  "deadline-passed-answers-timeout": SERVICE_API_NOT_SERVED,
  "issues-reported-together": SERVICE_API_NOT_SERVED,
  "relay-sends-restricted-fields": SERVICE_API_NOT_SERVED,
  "wrong-method-on-tasks-service-path": SERVICE_API_NOT_SERVED,
};
