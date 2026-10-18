import { describe, expect, test } from "vitest";
import { treeNodesRelayedTasks } from "../../tree/nodes/test-support.js";
import {
  deriveWireLoadFixture,
  deriveWireOperation,
  deriveWireReferenceVariants,
  deriveWireResponseHeaders,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("lifecycle"));

const concurrencyParamsOf = (derived: typeof run, id: string, place: "query" | "header") =>
  (deriveWireOperation(derived, id).params?.[place] ?? [])
    .filter((param) => param.derivedFrom?.derivation === "concurrency.version")
    .map(({ name, type, required }) => ({ name, type, required }));

const concurrencyParams = (id: string, place: "query" | "header") =>
  concurrencyParamsOf(run, id, place);

const INTEGER = { kind: "scalar", type: "integer", refinements: {} };

const STRING = { kind: "scalar", type: "string", refinements: {} };

describe("version param", () => {
  test("a query version is a required query parameter typed like field, on update and delete", () => {
    expect(run.diagnostics).toEqual([]);

    for (const id of ["updateNote", "deleteNote"]) {
      expect(concurrencyParams(id, "query")).toEqual([
        { name: "revision", type: INTEGER, required: true },
      ]);
      expect(
        deriveWireOperation(run, id).params?.query.find((param) => param.name === "revision")?.wire,
      ).toEqual({ kind: "number", style: "form", explode: true, brackets: false });
    }
  });

  test("a body version is the input's property, read from the query on a DELETE without input", () => {
    expect(concurrencyParams("updateDraft", "query")).toEqual([]);
    expect(concurrencyParams("deleteDraft", "query")).toEqual([
      { name: "expectedRevision", type: INTEGER, required: true },
    ]);
  });

  test("concurrency.derivedFrom names the resource's concurrency, then a member route's inherit", () => {
    expect(deriveWireOperation(run, "updateDraft").concurrency?.derivedFrom).toEqual({
      derivation: "concurrency.version",
      from: [{ layer: "api", pointer: "/surfaces/app/routes/drafts/concurrency" }],
    });
    expect(deriveWireOperation(run, "publishDraft").concurrency?.derivedFrom?.from).toEqual([
      { layer: "api", pointer: "/surfaces/app/routes/drafts/concurrency" },
      {
        layer: "api",
        pointer: "/surfaces/app/routes/drafts/member/routes/publish/concurrency",
      },
    ]);
    expect(deriveWireOperation(run, "getNote").concurrency).toBeUndefined();
  });
});

describe("if-match and etag", () => {
  test("an If-Match version is a required string header, and the item's success responses carry the ETag", () => {
    expect(concurrencyParams("updateDoc", "header")).toEqual([
      { name: "If-Match", type: STRING, required: true },
    ]);
    expect(deriveWireResponseHeaders(run, "updateDoc")).toEqual({ 200: ["ETag"] });
  });

  test("a read of the resource carrying the item writes the ETag too, a page does not", () => {
    expect(deriveWireResponseHeaders(run, "listDocs")).toEqual({ 200: [] });
    expect(
      deriveWireOperation(run, "getDoc").responses?.[0]?.headers.find(
        (header) => header.name === "ETag",
      )?.derivedFrom?.derivation,
    ).toBe("concurrency.version");
  });
});

describe("relay routes of a versioned operation", () => {
  const RELAY = "      getTask: { relays: tasks.getTask }\n";
  const WITH_UPDATE = `${RELAY}      updateTask: { relays: tasks.updateTask }\n`;
  const BODY_VERSION = "concurrency: { version: body.expectedVersion, field: version }";
  const TASKS_ORIGIN = {
    api: "tasks",
    layer: "api",
    pointer: "/surfaces/app/routes/channels/member/routes/tasks/concurrency",
  };

  // The tasks api derived first, as the orchestrator does, then the service relaying it.
  const relayRun = (tasksReplacements: [string, string][]) => {
    const workspace = deriveWireReferenceVariants({
      "tasks/api.yaml": tasksReplacements,
      "tasks-service/api.yaml": [[RELAY, WITH_UPDATE]],
    });
    const tasks = deriveWireRunContract(workspace, "tasks", treeNodesRelayedTasks());

    return deriveWireRunContract(workspace, "tasksService", new Map([["tasks", tasks.draft]]));
  };

  test("a relayed body version names the public resource's concurrency", () => {
    const run = relayRun([]);

    expect(run.diagnostics).toEqual([]);
    expect(deriveWireOperation(run, "updateTask").concurrency?.derivedFrom).toEqual({
      derivation: "concurrency.version",
      from: [TASKS_ORIGIN],
    });
  });

  test("a relayed If-Match version takes its header, and a relayed read of the item its ETag", () => {
    const run = relayRun([
      [BODY_VERSION, "concurrency: { version: header.If-Match, field: version }"],
    ]);

    expect(run.diagnostics).toEqual([]);
    expect(concurrencyParamsOf(run, "updateTask", "header")).toEqual([
      { name: "If-Match", type: STRING, required: true },
    ]);
    expect(deriveWireResponseHeaders(run, "updateTask")).toEqual({
      200: ["Idempotency-Replayed", "ETag"],
    });
    expect(
      deriveWireOperation(run, "getTask").responses?.[0]?.headers.find(
        (header) => header.name === "ETag",
      )?.derivedFrom,
    ).toEqual({ derivation: "concurrency.version", from: [TASKS_ORIGIN] });
  });

  test("a relayed query version takes the public parameter's type", () => {
    const run = relayRun([
      [BODY_VERSION, "concurrency: { version: query.expectedVersion, field: version }"],
    ]);

    expect(run.diagnostics).toEqual([]);
    expect(concurrencyParamsOf(run, "updateTask", "query")).toEqual([
      {
        name: "expectedVersion",
        type: { ...INTEGER, refinements: { minimum: "1" } },
        required: true,
      },
    ]);
  });
});
