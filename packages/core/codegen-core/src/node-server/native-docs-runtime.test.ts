import { describe, expect, test } from "vitest";
import {
  assertComponentsHeld,
  assertOpenApi31,
  mergeComponents,
} from "../../native-docs-runtime/contract-document.js";

const TASK = { type: "object", properties: { title: { type: "string" } } };
const OTHER_TASK = { type: "object", properties: { name: { type: "string" } } };

describe("the guards of the framework's own document", () => {
  test("native docs helper refuses a 3.0 document and a component clash", () => {
    expect(() => assertOpenApi31("3.0.3", "tasks")).toThrow(/openapi: '3\.1\.0'/);
    expect(() => assertOpenApi31(undefined, "tasks")).toThrow(/needs 3\.1\.x/);
    expect(() => assertOpenApi31("3.1.0", "tasks")).not.toThrow();

    const held = { schemas: { Task: TASK } };

    expect(() => mergeComponents(held, { schemas: { Task: OTHER_TASK } }, "tasksService")).toThrow(
      /'schemas\.Task' of api 'tasksService' is .*"name".*already holds .*"title"/,
    );
  });

  test("an identical component is written once and the held document is not changed", () => {
    const held = { schemas: { Task: TASK } };
    const merged = mergeComponents(
      held,
      {
        schemas: { Task: structuredClone(TASK), Other: OTHER_TASK },
        securitySchemes: { token: {} },
      },
      "tasksService",
    );

    expect(merged).toEqual({
      schemas: { Task: TASK, Other: OTHER_TASK },
      securitySchemes: { token: {} },
    });
    expect(held).toEqual({ schemas: { Task: TASK } });
  });

  test("a component named like an Object.prototype member is added, not read as a clash", () => {
    const merged = mergeComponents(
      undefined,
      { schemas: { constructor: { type: "string" } } },
      "tasks",
    );

    expect(Object.hasOwn(merged.schemas ?? {}, "constructor")).toBe(true);
  });

  test("a finished document holding another value for a component is refused, naming both", () => {
    expect(() =>
      assertComponentsHeld(
        { components: { schemas: { Task: { type: "object" } } } },
        { schemas: { Task: { type: "string" } } },
        "tasks",
      ),
    ).toThrow(/'schemas\.Task' of api 'tasks'.*"type":"string".*"type":"object"/s);
  });
});
