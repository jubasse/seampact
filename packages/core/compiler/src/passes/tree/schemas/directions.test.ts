import { describe, expect, test } from "vitest";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);

const ROUTE = "/surfaces/app/routes/send";

describe("directions and unknown keys", () => {
  const run = treeSchemasRunApi(`enums:
  State: { values: [open, done], reason: "Local states." }
scalars:
  money: { type: string, pattern: '^[0-9]+$' }
headers:
  rightsVersion: { semantic: versionToken, response: X-Rights-Version, request: If-Rights-Version, schema: { format: money } }
  trace: { name: traceparent, in: request, semantic: traceContext, schema: { type: string } }
schemas:
  Payload: { type: object, properties: { state: { enum: State }, nested: Nested } }
  Nested: { type: object, properties: { amount: { format: money } } }
  Answer: { type: object, properties: { state: { enum: State } } }
  Unused: { type: object, properties: { a: { type: string } } }
  Github:
    type: object
    unknownKeys: { ignore: "GitHub adds payload fields." }
    properties: { action: { type: string } }
surfaces:
  app:
    routes:
      send:
        method: post
        input: { $ref: Payload, unknownKeys: { keep: "The handler forwards the rest." } }
        output: Answer
      hook:
        method: post
        input: Github
        responses:
          200: { body: Github }
`);
  const directionsOf = (id: string) => run.draft.schemas[id]?.directions;

  test("each schema, enum and named format takes the directions of the uses that reach it", () => {
    expect(run.diagnostics).toEqual([]);
    expect(directionsOf("Payload")).toEqual(["input"]);
    expect(directionsOf("Nested")).toEqual(["input"]);
    expect(directionsOf("Answer")).toEqual(["output"]);
    expect(directionsOf("Github")).toEqual(["input", "output"]);
    expect(directionsOf("Unused")).toEqual([]);
    expect(run.draft.enums.State?.directions).toEqual(["input", "output"]);
    // The version token header (no `in`) is read and answered.
    expect(run.draft.scalars.money?.directions).toEqual(["input", "output"]);
  });

  test("a use's unknownKeys sits on its input use, and an output answer holds none", () => {
    expect(run.service.typeUse(`${ROUTE}/input`, "input")).toEqual({
      kind: "ref",
      schema: "Payload",
      unknownKeys: {
        policy: "keep",
        reason: "The handler forwards the rest.",
        origin: { layer: "api", pointer: `${ROUTE}/input/unknownKeys` },
      },
    });
    expect(run.service.typeUse("/surfaces/app/routes/hook/input", "input")).toMatchObject({
      unknownKeys: { policy: "ignore", origin: { pointer: "/schemas/Github/unknownKeys" } },
    });
    expect(run.service.typeUse("/surfaces/app/routes/hook/responses/200/body", "output")).toEqual({
      kind: "ref",
      schema: "Github",
    });
  });

  test("unknownKeys where every use is output, or on a value with no keys, is refused", () => {
    const refused = treeSchemasRunApi(`schemas:
  Answer: { type: object, properties: { a: { type: string } } }
  Out:
    type: object
    properties: { inner: { $ref: Answer, unknownKeys: refuse } }
  Text: { type: string }
surfaces:
  app:
    routes:
      send:
        method: post
        input: { type: object, properties: { t: { $ref: Text, unknownKeys: refuse } } }
        output: { $ref: Answer, unknownKeys: { ignore: "Not for output." } }
        responses:
          201: { body: Out }
`);

    expect(located(refused)).toEqual([
      ["unknown-keys", `${ROUTE}/input/properties/t/unknownKeys`],
      ["unknown-keys", "/schemas/Out/properties/inner/unknownKeys"],
      ["unknown-keys", `${ROUTE}/output/unknownKeys`],
    ]);
    expect(refused.located).toBe(true);
  });

  test("unknownKeys on an alias declaration that only output uses reach is refused", () => {
    const refused = treeSchemasRunApi(`schemas:
  Answer: { type: object, properties: { a: { type: string } } }
  Strict: { $ref: Answer, unknownKeys: refuse }
  Loose: { $ref: Answer, unknownKeys: refuse }
surfaces:
  app:
    routes:
      send:
        method: post
        input: { type: object, properties: { loose: Loose } }
        output: Strict
`);

    expect(located(refused)).toEqual([["unknown-keys", "/schemas/Strict/unknownKeys"]]);
  });

  test("unknownKeys on a map, whose keys are free, is refused", () => {
    const refused = treeSchemasRunApi(`schemas:
  Labels: { type: object, additionalProperties: { type: string }, unknownKeys: refuse }
  Tags: { type: object, additionalProperties: { type: string } }
  Holder: { type: object, properties: { tags: { $ref: Tags, unknownKeys: refuse } } }
`);

    expect(located(refused)).toEqual([
      ["unknown-keys", "/schemas/Labels/unknownKeys"],
      ["unknown-keys", "/schemas/Holder/properties/tags/unknownKeys"],
    ]);
  });
});

describe("schema service", () => {
  test("a format meta field's schema is answered as an output use", () => {
    const run = treeSchemasRunApi(`enums:
  Region: { values: [eu, us], reason: "Serving regions." }
formats:
  house:
    success:
      item: { body: { data: $payload, meta: $meta } }
    meta:
      region: { fill: handler, schema: { enum: Region } }
`);

    expect(run.diagnostics).toEqual([]);
    expect(run.service.typeUse("/formats/house/meta/region/schema", "output")).toEqual({
      kind: "enum",
      enum: "Region",
    });
    expect(run.draft.enums.Region?.directions).toEqual(["output"]);
  });

  test("the params of a code declared on a tree node are hoisted as the catalogue's", () => {
    const run = treeSchemasRunApi(`surfaces:
  app:
    routes:
      tasks:
        kind: collection
        id: { taskId: { type: string } }
        errors:
          tasks.locked: { status: 423, params: { until: { type: string, format: date-time } } }
`);
    const pointer = "/surfaces/app/routes/tasks/errors/tasks.locked/params";

    expect(run.diagnostics).toEqual([]);
    expect(run.service.typeUse(pointer, "output")).toEqual({
      kind: "ref",
      schema: "TasksLockedParams",
    });
    expect(run.draft.schemas.TasksLockedParams).toMatchObject({
      directions: ["output"],
      origin: { layer: "api", pointer },
    });
  });
});
