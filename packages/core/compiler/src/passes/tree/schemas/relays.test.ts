import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DraftIR } from "../../../pipeline/seam.js";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);
const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });

const PUBLIC = `scalars:
  taskCode: { type: string, minLength: 3 }
enums:
  TaskState: { values: [open, done], reason: "Task states." }
  Priority: { values: [low, high], reason: "Priorities." }
schemas:
  Task:
    type: object
    required: [taskId]
    properties: { taskId: { format: taskCode }, state: { enum: TaskState }, owner: Owner }
  Owner: { type: object, properties: { name: { type: string } } }
  Filter: { type: object, properties: { priority: { enum: Priority } } }
  Gone: { type: object, properties: { at: { type: string } } }
`;

// The public api's draft after tree.schemas, with the relayed operation as its tree.nodes would write it.
function publicDraft(): DraftIR {
  const draft = treeSchemasRunApi(PUBLIC).draft;
  const task = draft.schemas.Task;
  const taskId = task?.kind === "object" ? task.properties[0]?.type : undefined;

  if (taskId === undefined) throw new Error("the public Task has no taskId");

  draft.operations.push({
    id: "getTask",
    params: {
      path: [{ name: "taskId", type: taskId, required: true }],
      query: [{ name: "filter", type: ref("Filter"), required: false }],
      header: [],
    },
    responses: [
      { status: 200, body: ref("Task"), shape: "item", headers: [] },
      { status: 410, body: ref("Gone"), shape: "item", headers: [] },
    ],
  });

  return draft;
}

const RELAY = `surfaces:
  internal:
    routes:
      getTask: { relays: pub.getTask }
`;
const RELAYS = "/surfaces/internal/routes/getTask/relays";

describe("relay declarations copied", () => {
  test("a declaration the copied shape uses joins the api with its public origin and directions", () => {
    const run = treeSchemasRunApi(RELAY, new Map([["pub", publicDraft()]]));
    const task = run.draft.schemas.Task;

    expect(run.diagnostics).toEqual([]);
    expect(Object.keys(run.draft.schemas)).toEqual(
      expect.arrayContaining(["Task", "Owner", "Filter"]),
    );
    expect(run.draft.schemas.Gone).toBeUndefined();
    expect(task?.origin).toEqual({ api: "pub", layer: "api", pointer: "/schemas/Task" });
    expect(task?.kind === "object" ? task.properties[0]?.origin : undefined).toEqual({
      api: "pub",
      layer: "api",
      pointer: "/schemas/Task/properties/taskId",
    });
    expect(task?.directions).toEqual(["output"]);
    expect(run.draft.schemas.Filter?.directions).toEqual(["input"]);
    expect(run.draft.enums.TaskState?.directions).toEqual(["output"]);
    expect(run.draft.enums.Priority?.directions).toEqual(["input"]);
    expect(run.draft.scalars.taskCode?.directions).toEqual(["input", "output"]);
    expect(run.draft.scalars.taskCode?.origin.api).toBe("pub");
  });

  test("an equal declaration of this api is kept once, a different one is refused naming both", () => {
    const local = `${PUBLIC.replace("TaskState: { values: [open, done]", "TaskState: { values: [open, closed]")}${RELAY}`;
    const run = treeSchemasRunApi(local, new Map([["pub", publicDraft()]]));

    expect(located(run)).toEqual([["relay-declaration", RELAYS]]);
    expect(run.diagnostics[0]?.message).toBe(
      "the enum 'TaskState' that pub.getTask uses differs from the one this api declares",
    );
    expect(run.diagnostics[0]?.related.map((r) => r.origin.pointer)).toEqual(["/enums/TaskState"]);
    expect(run.draft.schemas.Task?.origin).toEqual({ layer: "api", pointer: "/schemas/Task" });
    expect(run.draft.schemas.Task?.directions).toEqual(["output"]);
    expect(run.located).toBe(true);
  });

  test("a route naming an api that has not run copies nothing", () => {
    const run = treeSchemasRunApi(RELAY);

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.Task).toBeUndefined();
  });
});
