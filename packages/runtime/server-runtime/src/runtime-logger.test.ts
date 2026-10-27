import { expect, test, vi } from "vitest";
import {
  type BoundaryContext,
  boundaryContext,
  type ContractApi,
  logWriteFailure,
  runtimeLog,
  useRuntimeLogger,
} from "./index.js";

// One runtime serves every api of an app: each api's requests log through the logger its registration gave.

function requestOf(api: object): BoundaryContext {
  const context: unknown = { api };

  return context as BoundaryContext;
}

function apiNamed(id: string): ContractApi {
  const api: unknown = { id };

  return api as ContractApi;
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

test("two apis logging outside a request each reach their own logger", () => {
  const notesLogger = { warn: vi.fn(), error: vi.fn() };
  const tasksLogger = { warn: vi.fn(), error: vi.fn() };
  const notesApi = apiNamed("notes");
  const tasksApi = apiNamed("tasks");
  const writeFailure = new Error("socket closed");

  useRuntimeLogger(notesLogger, notesApi);
  useRuntimeLogger(tasksLogger, tasksApi);

  logWriteFailure(notesApi, writeFailure);
  logWriteFailure(tasksApi, writeFailure);

  expect(notesLogger.error).toHaveBeenCalledOnce();
  expect(notesLogger.error).toHaveBeenCalledWith(
    "seampact: writing a reply of api 'notes' failed",
    writeFailure,
  );
  expect(tasksLogger.error).toHaveBeenCalledOnce();
  expect(tasksLogger.error).toHaveBeenCalledWith(
    "seampact: writing a reply of api 'tasks' failed",
    writeFailure,
  );
});
