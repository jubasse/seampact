import { fileURLToPath } from "node:url";
import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { type LoadReader, loadFsReader } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import { compileWorkspace, type PipelineApiResult } from "../../../pipeline/orchestrator.js";
import {
  DERIVE_WIRE_FIXTURES,
  deriveWireFixtureJson,
  deriveWireLocated,
  deriveWireMembers,
} from "./test-support.js";

// A contract through every pass to the IR.

const REFERENCE = fileURLToPath(
  new URL("../../../../../../../fixtures/reference/", import.meta.url),
);

function compiled(reader: LoadReader, entry: string): readonly PipelineApiResult[] {
  const result = compileWorkspace({
    reader,
    entry,
    guard: true,
  });

  expect(result.diagnostics).toEqual([]);

  return result.apis;
}

function compiledInline(contract: string): PipelineApiResult {
  const [api] = compiled(loadMemoryReader({ "api.yaml": contract.trimStart() }), "api.yaml");

  if (api === undefined) throw new Error("the inline contract has no api");

  return api;
}

function compiledFixture(name: string): PipelineApiResult {
  const [api] = compiled(loadFsReader(`${DERIVE_WIRE_FIXTURES}${name}/`), "api.yaml");

  if (api === undefined) throw new Error(`the ${name} fixture has no api`);

  return api;
}

function irOf(api: PipelineApiResult): ContractIR {
  expect(api.diagnostics).toEqual([]);

  if (api.ir === undefined) throw new Error(`the api ${api.api} has no IR`);

  return api.ir;
}

const TASKS = (extra: string) => `
api: { name: tasks, version: 1 }
${extra}
schemas:
  Task:
    type: object
    properties: { id: { type: string }, title: { type: string } }
    required: [id, title]
surfaces:
  app:
    access: { public: "Tasks are public." }
    routes:
      tasks:
        kind: collection
        id: { taskId: { type: string } }
        idProperty: id
        item: Task
        ops: [get]
`;

describe("derive.wire matches the derive delta through the pipeline", () => {
  test.each(["tasks", "tasksService"] as const)(
    "%s: the IR holds the members of this half and the default api wire",
    (name) => {
      const api = compiled(loadFsReader(REFERENCE), "workspace.yaml").find(
        (candidate) => candidate.api === name,
      );

      if (api === undefined) throw new Error(`the reference has no api ${name}`);
      const ir = irOf(api);

      expect(deriveWireMembers(ir)).toEqual(
        deriveWireFixtureJson("reference", `${name}.derive-wire.json`),
      );
      expect(ir.api.wire).toEqual({ int64: "string", outputEnums: "enum", urls: "relative" });
    },
  );
});

describe("typed convention members", () => {
  test("a non-default int64, outputEnums and urls reach the IR", () => {
    const ir = irOf(compiledFixture("formats"));

    expect(ir.api.wire).toEqual({ int64: "number", outputEnums: "open", urls: "absolute" });
  });
});

describe("bucket limits", () => {
  test("a bucket without limit and window is warned about and the IR is still emitted", () => {
    const result = compileWorkspace({
      reader: loadMemoryReader({
        "api.yaml": TASKS("buckets: { burst: { key: [address] } }").trimStart(),
      }),
      entry: "api.yaml",
      guard: true,
    });

    expect(result.apis[0]?.diagnostics.map(deriveWireLocated)).toEqual([
      { rule: "seampact/derive/bucket-limits", pointer: "/buckets/burst", related: [] },
    ]);
    expect(result.apis[0]?.ir?.operations).toHaveLength(1);
  });
});

describe("formats", () => {
  test("bare by default: a contract with no format serves bare payloads and problem+json errors", () => {
    const ir = irOf(compiledInline(TASKS("")));
    const bare = ir.formats.bare;

    expect(Object.keys(ir.formats)).toEqual(["bare"]);
    expect(ir.operations.map(({ format }) => format)).toEqual(["bare"]);
    expect([bare?.media, bare?.error.media]).toEqual([
      "application/json",
      "application/problem+json",
    ]);
    expect(bare?.success.item.body).toEqual({ kind: "slot", slot: "payload", path: [] });
  });

  test("error formats write the code: a format whose error writes no $code is refused, one in a text compiles", () => {
    const format = (error: string) => `
conventions: { format: plain }
formats:
  plain:
    error: { body: ${error} }
`;
    const refused = compiledInline(TASKS(format("{ message: $detail }")));
    const written = irOf(
      compiledInline(TASKS(format(`{ type: 'https://errors.example.com/\${code}' }`))),
    );

    expect(refused.ir).toBeUndefined();
    expect(refused.diagnostics.map(deriveWireLocated)).toEqual([
      { rule: "seampact/tree/format-error-code", pointer: "/formats/plain/error", related: [] },
    ]);
    expect(written.formats.plain?.error.body).toEqual({
      kind: "object",
      members: [
        {
          name: { kind: "text", text: "type" },
          value: {
            kind: "text",
            parts: [
              { kind: "text", text: "https://errors.example.com/" },
              { kind: "slot", slot: "code", path: [] },
            ],
          },
        },
      ],
    });
  });

  test("format slot values: resourceType, typeName and idProperty reach the IR", () => {
    const ir = irOf(compiledFixture("formats"));

    expect(ir.operations.map(({ id, resource }) => [id, resource])).toEqual([
      ["getComment", { type: "comments", idParam: "commentId", idProperty: "id" }],
      ["getTask", { type: "todo-items", idParam: "taskId", idProperty: "id" }],
      ["listComments", { type: "comments", idProperty: "id" }],
      ["listTasks", { type: "todo-items", idProperty: "id" }],
    ]);
    expect(ir.schemas.Task).toMatchObject({ kind: "object", typeName: "TodoItem" });
  });
});
