import { expect, test, vi } from "vitest";
import { type BoundaryContext, boundaryContext, runtimeLog, useRuntimeLogger } from "./index.js";

// One runtime serves every api of an app: each api's requests log through the logger its registration gave.

function requestOf(api: object): BoundaryContext {
  const context: unknown = { api };

  return context as BoundaryContext;
}

test("an api registered without a logger does not log through another api's", () => {
  const notesLogger = { warn: vi.fn(), error: vi.fn() };
  const notesApi = { id: "notes" };
  const tasksApi = { id: "tasks" };
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  useRuntimeLogger(notesLogger, notesApi);
  useRuntimeLogger(undefined, tasksApi);
  useRuntimeLogger(undefined, notesApi);

  boundaryContext.run(requestOf(tasksApi), () => runtimeLog.error("tasks failed"));
  boundaryContext.run(requestOf(notesApi), () => runtimeLog.error("notes failed"));

  expect(consoleError).toHaveBeenCalledWith("tasks failed");
  expect(notesLogger.error).toHaveBeenCalledWith("notes failed");
  expect(notesLogger.error).not.toHaveBeenCalledWith("tasks failed");

  consoleError.mockRestore();
});
