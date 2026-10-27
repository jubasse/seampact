import type { ServerResponse } from "node:http";
import { expect, test, vi } from "vitest";
import {
  type BoundaryContext,
  type BoundaryHooks,
  boundaryContext,
  type ContractApi,
  type ContractReply,
  logWriteFailure,
  reportUnexpected,
  runtimeLog,
  useRuntimeLogger,
} from "./index.js";
import { writeContractReply } from "./node-reply.js";

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

test("a failing onUnexpectedError outside a request reaches its own api's logger", async () => {
  const notesLogger = { warn: vi.fn(), error: vi.fn() };
  const tasksLogger = { warn: vi.fn(), error: vi.fn() };
  const notesApi = apiNamed("notes");
  const tasksApi = apiNamed("tasks");
  const hookFailure = new Error("reporter down");
  const failingHooks: unknown = {
    onUnexpectedError: () => {
      throw hookFailure;
    },
  };
  const where = { api: "notes", operation: undefined, method: "GET", path: "/notes" };

  useRuntimeLogger(notesLogger, notesApi);
  useRuntimeLogger(tasksLogger, tasksApi);

  await reportUnexpected(failingHooks as BoundaryHooks, notesApi, new Error("boom"), where);

  expect(notesLogger.error).toHaveBeenCalledWith(
    "seampact: onUnexpectedError failed for operation '(none)' of api 'notes'",
    hookFailure,
  );
  expect(tasksLogger.error).not.toHaveBeenCalled();
});

test("a reply already sent outside a request is logged through its own api's logger", async () => {
  const notesLogger = { warn: vi.fn(), error: vi.fn() };
  const tasksLogger = { warn: vi.fn(), error: vi.fn() };
  const notesApi = apiNamed("notes");
  const tasksApi = apiNamed("tasks");
  const sentResponse: unknown = { headersSent: true };
  const reply: ContractReply = { status: 500, headers: [], body: new Uint8Array() };

  useRuntimeLogger(notesLogger, notesApi);
  useRuntimeLogger(tasksLogger, tasksApi);

  await writeContractReply(sentResponse as ServerResponse, notesApi, undefined, reply);

  expect(notesLogger.error).toHaveBeenCalledOnce();
  expect(tasksLogger.error).not.toHaveBeenCalled();
});
