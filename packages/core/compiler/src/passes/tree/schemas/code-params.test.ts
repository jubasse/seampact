import { describe, expect, test } from "vitest";
import { treeSchemasRunApi } from "./test-support.js";

const api = (pointer: string) => ({ layer: "api", pointer });
const tasksRoute = (errors: string) => `surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: { type: string } }
        errors:
${errors}
      boards:
        kind: collection
        id: { boardId: { type: string } }
        errors:
          tasks.locked: { status: 423, params: { until: { type: string } } }
`;
const TASKS = "/surfaces/app/routes/tasks/errors";
const BOARDS = "/surfaces/app/routes/boards/errors";

describe("error code params", () => {
  test("a default code declared with params on a tree node takes the reserved params id", () => {
    const run = treeSchemasRunApi(
      tasksRoute("          api.forbidden: { status: 403, params: { right: { type: string } } }"),
    );

    expect(run.diagnostics).toEqual([]);
    expect(run.service.typeUse(`${TASKS}/api.forbidden/params`, "output")).toEqual({
      kind: "ref",
      schema: "ApiForbiddenParams",
    });
    expect(run.draft.schemas.ApiForbiddenParams?.origin).toEqual(
      api(`${TASKS}/api.forbidden/params`),
    );
  });

  test("equal params on two nodes, or on a node and in the catalogue, are hoisted once", () => {
    const run = treeSchemasRunApi(
      `errors:\n  tasks.locked: { status: 423, params: { until: { type: string } } }\n${tasksRoute(
        "          tasks.locked: { status: 423, params: { until: { type: string } } }",
      )}`,
    );
    const shared = { kind: "ref", schema: "TasksLockedParams" };

    expect(run.diagnostics).toEqual([]);
    expect(run.service.typeUse("/errors/tasks.locked/params", "output")).toEqual(shared);
    expect(run.service.typeUse(`${TASKS}/tasks.locked/params`, "output")).toEqual(shared);
    expect(run.service.typeUse(`${BOARDS}/tasks.locked/params`, "output")).toEqual(shared);
    expect(run.draft.schemas.TasksLockedParams?.origin).toEqual(api("/errors/tasks.locked/params"));
  });

  test("different params of one code are left to the derive pass, the first declaration hoisted", () => {
    const run = treeSchemasRunApi(
      tasksRoute("          tasks.locked: { status: 423, params: { since: { type: string } } }"),
    );

    expect(run.diagnostics).toEqual([]);
    expect(run.service.typeUse(`${TASKS}/tasks.locked/params`, "output")).toEqual({
      kind: "ref",
      schema: "TasksLockedParams",
    });
    expect(run.service.typeUse(`${BOARDS}/tasks.locked/params`, "output")).toBeUndefined();
    expect(run.draft.schemas.TasksLockedParams).toMatchObject({ properties: [{ name: "since" }] });
  });
});
