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

describe("examples parsed, by shape", () => {
  const run = treeSchemasRunApi(`schemas:
  Push: { type: object, properties: { ref: { type: string } }, required: [ref] }
  Ping: { type: object, properties: { zen: { type: string } }, required: [zen] }
  Hook:
    discriminator: { from: header.X-Kind }
    oneOf: { push: Push, ping: Ping }
  Upload: { type: object, properties: { content: { file: { media: [image/png] } } } }
  Inner: { type: object, properties: { count: { type: integer } }, required: [count] }
  Note:
    type: object
    properties:
      body: { type: string, contentMediaType: application/json, contentSchema: Inner }
  Maybe: { type: object, nullable: true, properties: { a: { type: string } }, examples: [null] }
`);
  const check = (value: unknown, use: IrWriter.TypeUse) => run.service.checkExample(value, use);

  test("a header-tagged union fits a value that fits one variant", () => {
    expect(run.diagnostics).toEqual([]);
    expect(check({ zen: "calm" }, ref("Hook"))).toEqual([]);
    expect(check({ other: 1 }, ref("Hook"))).toEqual([
      { pointer: "", message: "the value fits no variant of Hook" },
    ]);
  });

  test("a file example is any string", () => {
    expect(check({ content: "photo.png" }, ref("Upload"))).toEqual([]);
    expect(check({ content: 7 }, ref("Upload"))).toEqual([
      { pointer: "/content", message: "a file example is a string" },
    ]);
  });

  test("every issue of a JSON text is reported at the string that holds it", () => {
    expect(check({ body: '{"count": "x", "m": 1}' }, ref("Note"))).toEqual([
      {
        pointer: "/body",
        message: "the JSON text does not fit at '/m': 'm' is not a property of Inner",
      },
      { pointer: "/body", message: "the JSON text does not fit at '/count': 'x' is not a number" },
    ]);
  });

  test("an authored value in a message is quoted and cut short", () => {
    const [unsafe] = check({ count: 1, "a\u202e": 1 }, ref("Inner"));
    const [long] = check({ count: 1, [`k${"x".repeat(200)}`]: 1 }, ref("Inner"));

    expect(unsafe?.message).toBe("'a\\u202E' is not a property of Inner");
    expect(long?.message).toMatch(/^'kx+…' is not a property of Inner$/);
    expect(long?.message.length).toBeLessThan(120);
  });

  test("a null example written on a schema declared nullable fits it", () => {
    expect(located(run)).toEqual([]);
    expect(run.draft.schemas.Maybe?.examples).toEqual([null]);
  });

  test("an example of a schema whose property failed to compile reports no second issue", () => {
    const refused = treeSchemasRunApi(`schemas:
  Broken:
    type: object
    examples: [{ bad: 1 }]
    properties: { bad: { $ref: Missing } }
`);

    expect(located(refused)).toEqual([["schema-unknown", "/schemas/Broken/properties/bad"]]);
  });
});

describe("text examples parsed by the wire form", () => {
  const run = treeSchemasRunApi(CATALOGUES);
  const text = (value: string, use: IrWriter.TypeUse) =>
    run.service.checkTextExample(value, use).map((issue) => issue.message);
  const scalar = (
    type: IrWriter.ScalarTypeUse["type"],
    refinements: IrWriter.Refinements = {},
    format?: IrWriter.ScalarTypeUse["format"],
  ): IrWriter.TypeUse => ({
    kind: "scalar",
    type,
    refinements,
    ...(format === undefined ? {} : { format }),
  });

  test("a number, boolean, int64, string or enum text stands for its value", () => {
    expect(text("12", scalar("integer", { minimum: "1" }))).toEqual([]);
    expect(text("1.5e2", scalar("number"))).toEqual([]);
    expect(text("true", scalar("boolean"))).toEqual([]);
    expect(text("9223372036854775807", scalar("integer", {}, "int64"))).toEqual([]);
    expect(text("abc", scalar("string", { maxLength: 3 }))).toEqual([]);
    expect(text("open", { kind: "enum", enum: "State" })).toEqual([]);
  });

  test("a text that its wire form does not read, or whose value does not fit, is refused", () => {
    expect(text("twelve", scalar("integer"))).toEqual(["'twelve' is not a number"]);
    expect(text("1.5", scalar("integer"))).toEqual(["1.5 is not an integer in the safe range"]);
    expect(text("0", scalar("integer", { minimum: "1" }))).toEqual(["0 is not at least 1"]);
    expect(text("yes", scalar("boolean"))).toEqual(["'yes' is not 'true' or 'false'"]);
    expect(text("closed", { kind: "enum", enum: "State" })).toEqual([
      "'closed' is not a value of State",
    ]);
    expect(text("x", ref("Task"))).toEqual(["this ref use has no text form"]);
    expect(text("1e400", scalar("number"))).toEqual(["'1e400' is past the range of a JSON number"]);
  });
});

describe("defaults parsed like an example", () => {
  test("a default that fits is kept, one that does not is refused at its pointer", () => {
    const run = treeSchemasRunApi(`schemas:
  Settings:
    type: object
    properties:
      size: { type: integer, minimum: 1, default: 10 }
      note: { type: string, nullable: true, default: null }
      limits: { type: array, items: { type: integer }, default: [1, "two"] }
      level: { type: integer, default: low }
  Small: { pick: { from: Settings, fields: [size] }, properties: { size: { default: 0 } } }
`);

    expect(located(run)).toEqual([
      ["default-value", "/schemas/Settings/properties/limits/default/1"],
      ["default-value", "/schemas/Settings/properties/level/default"],
      ["default-value", "/schemas/Small/properties/size/default"],
    ]);
    expect(run.diagnostics[1]?.message).toBe(
      "the default does not fit its schema at '': 'low' is not a number",
    );
    expect(run.located).toBe(true);
  });
});

describe("defaults at query fields", () => {
  const ROUTES = `schemas:
  TaskId: { type: string, format: uuid }
  Task: { type: object, required: [taskId], properties: { taskId: TaskId } }
surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        ops:
          list:
            query:
              limit?: { type: integer, minimum: 1, default: 20 }
              page?: { type: integer, default: first }
              raw?: { opaque: "Free-form.", default: {} }
              sort: { type: string, default: title }
            headers: { X-Trace?: { type: string, default: none } }
`;

  test("an optional query field takes a default, parsed like an example; elsewhere it is refused", () => {
    const run = treeSchemasRunApi(ROUTES);
    const list = "/surfaces/app/routes/tasks/ops/list";

    expect(located(run)).toEqual([
      ["mark-position", `${list}/query/raw?/default`],
      ["mark-position", `${list}/query/sort/default`],
      ["mark-position", `${list}/headers/X-Trace?/default`],
      ["default-value", `${list}/query/page?/default`],
    ]);
    expect(run.diagnostics[1]?.message).toBe(
      "'default' sits on an optional property or an optional query field",
    );
    expect(run.diagnostics[3]?.message).toBe(
      "the default does not fit its schema at '': 'first' is not a number",
    );
    expect(run.located).toBe(true);
  });
});
