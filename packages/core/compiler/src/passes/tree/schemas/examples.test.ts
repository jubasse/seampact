import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);
const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });

const CATALOGUES = `enums:
  State: { values: [open, done], reason: "Local states." }
schemas:
  Task:
    type: object
    required: [taskId, title]
    properties:
      taskId: { type: string, format: uuid }
      title: { type: string, minLength: 1, maxLength: 5, pattern: '^[a-z]+$' }
      state: { enum: State }
      due: { type: string, format: date, nullable: true }
      at: { type: string, format: date-time }
      big: { type: integer, format: int64 }
      price: { type: string, format: decimal, minimum: 0, multipleOf: 0.01 }
      count: { type: integer, exclusiveMinimum: 0 }
      tags: { type: array, items: { type: string }, maxItems: 2 }
      meta: { type: string, contentMediaType: application/json, contentSchema: Labels }
      extra: { opaque: "Free-form." }
  Labels: { type: object, additionalProperties: { type: boolean }, propertyNames: { type: string, maxLength: 3 } }
  Event:
    discriminator: kind
    oneOf:
      created: { type: object, properties: { taskId: { type: string } } }
      deleted: { type: object, properties: { reason: { type: string } } }
`;

describe("examples parsed", () => {
  const run = treeSchemasRunApi(CATALOGUES);
  const check = (value: unknown, use: IrWriter.TypeUse) => run.service.checkExample(value, use);
  const valid = {
    taskId: "0b5d6a7e-1c2f-4e3a-9b8c-7d6e5f4a3b2c",
    title: "abc",
    state: "open",
    due: null,
    at: "2026-10-18T02:30:00.123+04:00",
    big: "9223372036854775807",
    price: "12.50",
    count: 1,
    tags: ["a"],
    meta: '{"abc": true}',
    extra: { anything: [1] },
  };

  test("a value that fits answers no issue", () => {
    expect(run.diagnostics).toEqual([]);
    expect(check(valid, ref("Task"))).toEqual([]);
    expect(check({ kind: "created", taskId: "t" }, ref("Event"))).toEqual([]);
  });

  test.each([
    ["taskId", "0b5d6a7e", "/taskId"],
    ["title", "", "/title"],
    ["title", "abcdef", "/title"],
    ["title", "ABC", "/title"],
    ["state", "closed", "/state"],
    ["at", "2026-10-18T02:30:00", "/at"],
    ["at", "2026-10-18T23:59:60Z", "/at"],
    ["due", "2026-02-30", "/due"],
    ["big", 12, "/big"],
    ["big", "9223372036854775808", "/big"],
    ["price", "-1", "/price"],
    ["price", "1.005", "/price"],
    ["count", 0, "/count"],
    ["count", 1.5, "/count"],
    ["tags", ["a", "b", "c"], "/tags"],
    ["tags", [1], "/tags/0"],
    ["meta", "{", "/meta"],
    ["meta", '{"long": true}', "/meta"],
    ["title", null, "/title"],
  ])("%s: %j is refused at %s", (key, value, pointer) => {
    expect(check({ ...valid, [key]: value }, ref("Task")).map((issue) => issue.pointer)).toEqual([
      pointer,
    ]);
  });

  test("unknown keys, missing required properties and unknown tags are refused", () => {
    const { taskId: _taskId, ...missing } = valid;

    expect(check({ ...valid, other: 1 }, ref("Task"))).toEqual([
      { pointer: "/other", message: "'other' is not a property of Task" },
    ]);
    expect(check(missing, ref("Task"))).toEqual([
      { pointer: "", message: "the required property 'taskId' is missing" },
    ]);
    expect(check({ kind: "moved" }, ref("Event")).map((issue) => issue.pointer)).toEqual(["/kind"]);
    expect(check({ kind: "deleted", taskId: "t" }, ref("Event")).map((i) => i.pointer)).toEqual([
      "/taskId",
    ]);
  });

  test("a narrowed enum use takes only its values", () => {
    const narrowed: IrWriter.TypeUse = {
      kind: "enum",
      enum: "State",
      narrowedTo: { values: ["done"] },
    };

    expect(check("open", narrowed)).toHaveLength(1);
    expect(check("done", narrowed)).toEqual([]);
  });

  test("written examples are parsed at compile time, each issue at its pointer inside the value", () => {
    const refused = treeSchemasRunApi(`${CATALOGUES}  Sample:
    type: object
    examples: [{ title: abc }, { title: 7 }]
    properties:
      title: { type: string, examples: [ok, 3] }
      list: { type: array, items: { type: integer, examples: [x] } }
`);

    expect(located(refused)).toEqual([
      ["example-value", "/schemas/Sample/properties/title/examples/1"],
      ["example-value", "/schemas/Sample/properties/list/items/examples/0"],
      ["example-value", "/schemas/Sample/examples/1/title"],
    ]);
    expect(refused.located).toBe(true);
    expect(refused.diagnostics[2]?.message).toBe(
      "the example does not fit its schema at '/title': 7 is not a string",
    );
  });
});
