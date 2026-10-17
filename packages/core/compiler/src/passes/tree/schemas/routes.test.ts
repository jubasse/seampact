import { describe, expect, test } from "vitest";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);
const propertiesOf = (run: TreeSchemasRun, id: string) => {
  const schema = run.draft.schemas[id];

  return schema?.kind === "object" ? schema.properties : [];
};

const ROUTES = "/surfaces/app/routes";
const TASKS = `${ROUTES}/tasks`;
const ITEM = `schemas:
  TaskId: { type: string, format: uuid }
  Task:
    type: object
    required: [taskId, version]
    properties: { taskId: TaskId, version: { type: integer, minimum: 1 } }
  UpdateTask: { type: object, properties: { title: { type: string } } }
`;

describe("hoisted names", () => {
  test("an inline route schema takes its operation's name and the position's role", () => {
    const run = treeSchemasRunApi(`${ITEM}surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        ops:
          list:
            query: { filter: { type: object, properties: { state: { type: string } } } }
        member:
          routes:
            assign:
              method: post
              input: { type: object, properties: { userId: { type: string } } }
              output: { type: object, properties: { ok: { type: boolean } } }
              headers: { X-Context: { type: object, properties: { a: { type: string } } } }
              responses:
                202: { body: { type: object, properties: { queued: { type: boolean } } } }
`);
    const assign = `${TASKS}/member/routes/assign`;

    expect(run.diagnostics).toEqual([]);
    expect(Object.keys(run.draft.schemas)).toEqual(
      expect.arrayContaining([
        "ListTasksQueryFilter",
        "AssignTaskInput",
        "AssignTaskOutput",
        "AssignTaskHeadersXContext",
        "AssignTaskResponse202",
      ]),
    );
    expect(run.draft.schemas.AssignTaskResponse202?.name).toEqual({
      segments: ["assign", "task"],
      role: "response",
      status: 202,
    });
    expect(run.service.typeUse(`${assign}/input`, "input")).toEqual({
      kind: "ref",
      schema: "AssignTaskInput",
    });
    expect(run.service.typeUse(`${TASKS}/ops/list/query/filter`, "input")).toEqual({
      kind: "ref",
      schema: "ListTasksQueryFilter",
    });
  });

  test("an operation without a name is skipped, an inline schema outside an operation refused", () => {
    const run = treeSchemasRunApi(`${ITEM}surfaces:
  app:
    routes:
      tasks:
        kind: collection
        item: { type: object, properties: { a: { type: string } } }
        ops:
          get: { output: { type: object, properties: { b: { type: string } } } }
`);

    expect(located(run)).toEqual([["schema-inline", `${TASKS}/item`]]);
    expect(run.service.typeUse(`${TASKS}/ops/get/output`, "output")).toBeUndefined();
  });
});

describe("batch ids input", () => {
  const batch = (op: string, conventions = "") =>
    treeSchemasRunApi(`${ITEM}${conventions}surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        ops: { batch: ${op} }
`);

  test("the batch op's ids input is an array of the id type with maxIds, derived from the op", () => {
    const run = batch("{ maxIds: 50 }");
    const op = `${TASKS}/ops/batch`;

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.GetTasksBatchInput).toMatchObject({
      name: { segments: ["get", "tasks", "batch"], role: "input" },
      origin: { pointer: op },
    });
    expect(propertiesOf(run, "GetTasksBatchInput")).toEqual([
      {
        name: "ids",
        type: {
          kind: "array",
          items: { kind: "scalar", type: "string", format: "uuid", refinements: {} },
          maxItems: 50,
        },
        optional: false,
        nullable: false,
        sensitive: false,
        deprecated: false,
        docs: {},
        extensions: {},
        origin: { layer: "api", pointer: `${op}/maxIds` },
        derivedFrom: { derivation: "batch.read", from: [{ layer: "api", pointer: op }] },
      },
    ]);
    expect(run.service.typeUse(op, "input")).toEqual({ kind: "ref", schema: "GetTasksBatchInput" });
  });

  test("maxIds comes from the conventions when the op sets none, and one of them is needed", () => {
    const run = batch("{}", "conventions: { batch: { maxIds: 20 } }\n");

    expect(propertiesOf(run, "GetTasksBatchInput")[0]).toMatchObject({
      type: { maxItems: 20 },
      origin: { pointer: "/conventions/batch/maxIds" },
    });
    expect(located(batch("{}"))).toEqual([["batch-ids", `${TASKS}/ops/batch`]]);
    expect(batch("{ input: UpdateTask }").draft.schemas.GetTasksBatchInput).toBeUndefined();
  });

  test("the id type is the one property of a named id schema; two id parameters are refused", () => {
    const named = (id: string) =>
      treeSchemasRunApi(`${ITEM}  TaskKey: { type: object, properties: ${id} }
surfaces:
  app:
    routes:
      tasks: { kind: collection, id: TaskKey, item: Task, ops: { batch: { maxIds: 5 } } }
`);

    expect(propertiesOf(named("{ taskId: TaskId }"), "GetTasksBatchInput")[0]?.type).toMatchObject({
      items: { format: "uuid" },
    });
    expect(located(named("{ taskId: TaskId, part: TaskId }"))).toContainEqual([
      "batch-ids",
      `${TASKS}/ops/batch`,
    ]);
  });
});

describe("concurrency version property", () => {
  const versioned = (routes: string) =>
    treeSchemasRunApi(`${ITEM}  ArchiveTask: { type: object, properties: { reason: { type: string } } }
surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        concurrency: { version: body.expectedVersion, field: version }
${routes}`);

  test("a body source adds the version after the authored fields, typed like the item field", () => {
    const run = versioned(`        ops: { update: { input: UpdateTask }, delete: {} }
        member:
          routes:
            archive: { method: post, concurrency: inherit, input: ArchiveTask }
            note: { method: post, input: { type: object, properties: { text: { type: string } } } }
`);
    const version = { layer: "api", pointer: `${TASKS}/concurrency/version` };

    expect(run.diagnostics).toEqual([]);
    expect(propertiesOf(run, "UpdateTask").map((p) => p.name)).toEqual([
      "title",
      "expectedVersion",
    ]);
    expect(propertiesOf(run, "UpdateTask")[1]).toMatchObject({
      type: { kind: "scalar", type: "integer", refinements: { minimum: "1" } },
      optional: false,
      origin: version,
      derivedFrom: { derivation: "concurrency.version", from: [version] },
    });
    expect(propertiesOf(run, "ArchiveTask")[1]?.derivedFrom?.from).toEqual([
      version,
      { layer: "api", pointer: `${TASKS}/member/routes/archive/concurrency` },
    ]);
    expect(propertiesOf(run, "NoteTaskInput").map((p) => p.name)).toEqual(["text"]);
  });

  test("an input shared with an unversioned route, a declared version or a missing field is refused", () => {
    const shared =
      versioned(`        ops: { update: { input: UpdateTask }, create: { input: UpdateTask } }
`);

    expect(located(shared)).toEqual([["concurrency-version", `${TASKS}/ops/update/input`]]);
    expect(shared.diagnostics[0]?.related).toEqual([
      {
        origin: { layer: "api", pointer: `${TASKS}/ops/create/input` },
        message: "this route uses 'UpdateTask' too",
      },
    ]);

    const declared = versioned(`        ops:
          update: { input: { type: object, properties: { expectedVersion: { type: integer } } } }
`);
    const opaque = versioned(`        ops: { update: { input: { opaque: "Free-form." } } }
`);
    const missing = treeSchemasRunApi(`${ITEM}surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        concurrency: { version: body.expectedVersion, field: revision }
        ops: { update: { input: UpdateTask } }
`);

    expect(located(declared)).toEqual([["concurrency-version", `${TASKS}/ops/update/input`]]);
    expect(located(opaque)).toEqual([["concurrency-version", `${TASKS}/ops/update/input`]]);
    expect(located(missing)).toEqual([["concurrency-field", `${TASKS}/concurrency/field`]]);
  });

  test("an input schema used by an output or by another schema is refused and left unchanged", () => {
    const item = versioned(`        ops: { update: { input: Task } }
`);

    expect(located(item)).toEqual([["concurrency-version", `${TASKS}/ops/update/input`]]);
    expect(item.diagnostics[0]?.related?.[0]?.origin.pointer).toBe(`${TASKS}/item`);
    expect(propertiesOf(item, "Task").map((p) => p.name)).toEqual(["taskId", "version"]);

    const nested = versioned(`        ops:
          update: { input: UpdateTask }
          get: { output: { type: object, properties: { draft: UpdateTask } } }
`);

    expect(located(nested)).toEqual([["concurrency-version", `${TASKS}/ops/update/input`]]);
    expect(nested.diagnostics[0]?.related?.[0]?.origin.pointer).toBe(`${TASKS}/ops/get/output`);
    expect(propertiesOf(nested, "UpdateTask").map((p) => p.name)).toEqual(["title"]);
  });

  test("a missing field is refused once per owner, whatever the version source", () => {
    const owner = (version: string, ops: string) =>
      treeSchemasRunApi(`${ITEM}  OtherUpdate: { type: object, properties: { note: { type: string } } }
surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        concurrency: { version: ${version}, field: nope }
        ops: ${ops}
`);
    const missing = [["concurrency-field", `${TASKS}/concurrency/field`]];

    expect(located(owner("query.expectedVersion", "{ delete: {} }"))).toEqual(missing);
    expect(located(owner("header.If-Match", "{ delete: {} }"))).toEqual(missing);
    expect(located(owner("body.expectedVersion", "{ delete: {} }"))).toEqual(missing);
    expect(
      located(
        owner(
          "body.expectedVersion",
          "{ update: { input: UpdateTask }, delete: { input: OtherUpdate } }",
        ),
      ),
    ).toEqual(missing);

    const unknownItem = treeSchemasRunApi(`${ITEM}surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Missing
        concurrency: { version: query.expectedVersion, field: nope }
        ops: { delete: {} }
`);

    expect(located(unknownItem).map(([rule]) => rule)).not.toContain("concurrency-field");
    expect(unknownItem.diagnostics).not.toEqual([]);
  });
});
