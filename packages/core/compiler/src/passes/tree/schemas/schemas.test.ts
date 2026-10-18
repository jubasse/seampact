import { describe, expect, test } from "vitest";
import { draftFixture, draftFixtureSchemaTables } from "../../../pipeline/draft-fixture.js";
import {
  type TreeSchemasRun,
  treeSchemasRules,
  treeSchemasRunApi,
  treeSchemasRunReference,
} from "./test-support.js";

const schemaOf = (run: TreeSchemasRun, id: string) => run.draft.schemas[id];
const propertyOf = (run: TreeSchemasRun, id: string, name: string) => {
  const schema = schemaOf(run, id);

  return schema?.kind === "object" ? schema.properties.find((p) => p.name === name) : undefined;
};

const typeOf = (run: TreeSchemasRun, id: string, name: string) => propertyOf(run, id, name)?.type;
const schemas = (yaml: string) => treeSchemasRunApi(`schemas:\n${yaml}`);
const at = (pointer: string) => ({ layer: "api", pointer });

describe("tree.schemas matches the after-tree fixture", () => {
  test.each(["tasks", "tasksService"] as const)("%s: schemas, scalars and enums", (api) => {
    const run = treeSchemasRunReference(api);

    expect(run.diagnostics).toEqual([]);
    const expected = Object.values(draftFixture(api, "after-tree").schemas);
    // The core issue schema stays seeded when a layer replaced the schema_invalid params; finalize drops it.
    const written = Object.values(run.draft.schemas).filter(
      (schema) => schema.id !== "ApiSchemaInvalidIssue" || expected.some((e) => e.id === schema.id),
    );

    expect(written).toEqual(expect.arrayContaining(expected));
    expect(written.map((s) => s.id).sort()).toEqual(expected.map((s) => s.id).sort());
    expect(run.draft.scalars).toEqual({});
    expect(Object.values(run.draft.enums)).toEqual(
      Object.values(draftFixture(api, "after-tree").enums),
    );
  });

  test.each(["tasks", "tasksService"] as const)(
    "%s: the service answers the fixture's uses",
    (api) => {
      const run = treeSchemasRunReference(api);

      for (const row of draftFixtureSchemaTables(api).typeUses) {
        const answer = run.service.typeUse(row.pointer, row.direction);

        expect([row.pointer, answer]).toEqual([row.pointer, row.use]);
      }
    },
  );
});

describe("schema shapes", () => {
  const run = schemas(`
  Shapes:
    type: object
    required: [list]
    properties:
      list: { type: array, items: { type: string }, minItems: 1, maxItems: 3 }
      table: { type: object, additionalProperties: { type: integer }, propertyNames: { type: string, format: uuid } }
      blob: { opaque: "A third party's free-form value." }
      upload: { file: { media: [image/png], maxSize: 2KiB } }
      merged: { allOf: [Named, { type: object, properties: { extra: { type: boolean } } }] }
      json: { type: string, contentMediaType: application/json, contentSchema: Named }
  Named: { type: object, properties: { name: { type: string } } }
  Tags: { type: array, items: { type: string } }
  UsesTags: { type: object, properties: { tags: Tags } }
`);

  test("each shape compiles to its type use, objects and maps hoisted", () => {
    expect(run.diagnostics).toEqual([]);
    expect(typeOf(run, "Shapes", "list")).toEqual({
      kind: "array",
      items: { kind: "scalar", type: "string", refinements: {} },
      minItems: 1,
      maxItems: 3,
    });
    expect(typeOf(run, "Shapes", "table")).toEqual({ kind: "ref", schema: "ShapesTable" });
    expect(schemaOf(run, "ShapesTable")).toMatchObject({
      kind: "map",
      keys: { kind: "scalar", type: "string", format: "uuid", refinements: {} },
      values: { kind: "scalar", type: "integer", refinements: {} },
      name: { segments: ["shapes", "table"], role: "property" },
    });
    expect(typeOf(run, "Shapes", "blob")).toEqual({
      kind: "opaque",
      reason: "A third party's free-form value.",
      origin: at("/schemas/Shapes/properties/blob"),
    });
    expect(typeOf(run, "Shapes", "upload")).toEqual({
      kind: "file",
      media: ["image/png"],
      maxSizeBytes: 2048,
    });
    expect(schemaOf(run, "ShapesMerged")).toMatchObject({
      kind: "object",
      properties: [{ name: "name" }, { name: "extra" }],
    });
    expect(typeOf(run, "Shapes", "json")).toEqual({
      kind: "scalar",
      type: "string",
      refinements: {},
      content: { media: "application/json", schema: { kind: "ref", schema: "Named" } },
    });
    expect(typeOf(run, "UsesTags", "tags")).toEqual(
      typeOf(run, "Shapes", "list") && {
        kind: "array",
        items: { kind: "scalar", type: "string", refinements: {} },
      },
    );
    expect(schemaOf(run, "Tags")).toBeUndefined();
  });

  test.each([
    ["A: {}", "schema-shape"],
    ["A: { type: object }", "object-empty"],
    ["A: { type: array }", "schema-shape"],
    ["A: { type: string, items: { type: string } }", "schema-keyword"],
    ["A: { allOf: [{ type: string }] }", "all-of-member"],
    ["A: { type: object, properties: { b: Missing } }", "schema-unknown"],
    ["A: { type: object, properties: { b: { enum: Missing } } }", "enum-unknown"],
    ["A: { type: object, required: [c], properties: { b: { type: string } } }", "required-unknown"],
    ["A: { type: object, properties: { b: { opaque: why, sensitive: true } } }", "mark-position"],
    [
      "A: { type: object, additionalProperties: { type: string }, propertyNames: { type: integer } }",
      "map-keys",
    ],
    ["A: { type: array, items: A }", "schema-cycle"],
    [
      "A: { type: object, required: [b], properties: { b: B } }\n  B: { type: object, required: [a], properties: { a: A } }",
      "schema-cycle",
    ],
    [
      "A: { allOf: [{ type: object, properties: { x: { type: string } } }, { type: object, properties: { x: { type: integer } } }] }",
      "all-of-property",
    ],
  ])("%s is refused (%s)", (yaml, rule) => {
    expect(treeSchemasRules(schemas(`  ${yaml}`))).toContain(rule);
  });
});

test("an enum use whose source enums form a cycle names the cycle", () => {
  const run = treeSchemasRunApi(`enums:
  A: { source: { enum: B } }
  B: { source: { enum: A } }
schemas:
  S: { type: object, properties: { a: { enum: A } } }
`);

  // The use, then each enum of the catalogue.
  expect(run.diagnostics.map((d) => d.origin.pointer)).toEqual([
    "/schemas/S/properties/a/enum",
    "/enums/A/source/enum",
    "/enums/B/source/enum",
  ]);
  expect(new Set(treeSchemasRules(run))).toEqual(new Set(["enum-cycle"]));
  expect(run.diagnostics[0]?.message).toContain("A -> B -> A");
});

describe("tagged unions", () => {
  const run = schemas(`
  Notice:
    discriminator: kind
    oneOf:
      done: TaskDone
      assigned: { type: object, required: [to], properties: { to: { type: string } } }
      cancelled: { type: object }
  TaskDone: { type: object, properties: { at: { type: string, format: date-time } } }
  GithubEvent:
    discriminator: { from: header.X-GitHub-Event }
    oneOf: { ping: TaskDone }
`);

  test("variants sorted by tag, inline ones hoisted, the tag kept out of them", () => {
    expect(run.diagnostics).toEqual([]);
    expect(schemaOf(run, "Notice")).toMatchObject({
      kind: "union",
      tag: { in: "body", property: "kind" },
      variants: [
        { tag: "assigned", schema: "NoticeAssigned" },
        { tag: "cancelled", schema: "NoticeCancelled" },
        { tag: "done", schema: "TaskDone" },
      ],
    });
    expect(schemaOf(run, "NoticeAssigned")).toMatchObject({
      name: { segments: ["notice", "assigned"], role: "variant" },
      properties: [{ name: "to" }],
    });
    expect(schemaOf(run, "NoticeCancelled")).toMatchObject({ kind: "object", properties: [] });
    expect(schemaOf(run, "GithubEvent")).toMatchObject({
      tag: { in: "header", name: "X-GitHub-Event" },
    });
  });

  test.each([
    [
      "U: { oneOf: { a: B } }\n  B: { type: object, properties: { x: { type: string } } }",
      "union-discriminator",
    ],
    ["U: { discriminator: k, oneOf: { a: { type: string } } }", "union-variant"],
    [
      "U: { discriminator: k, oneOf: { a: B } }\n  B: { type: object, properties: { k: { type: string } } }",
      "union-tag",
    ],
    [
      "H: { discriminator: { from: header.X-Kind }, oneOf: { a: B } }\n  B: { type: object, properties: { h: H } }",
      "union-header",
    ],
  ])("%s is refused (%s)", (yaml, rule) => {
    expect(treeSchemasRules(schemas(`  ${yaml}`))).toContain(rule);
  });
});

describe("optional and nullable", () => {
  const run = schemas(`
  Article:
    type: object
    required: [title, summary]
    properties:
      title: { type: string }
      summary: { type: string, nullable: true }
      publishOn: { type: string, format: date, nullable: true }
      tags: { type: array, items: { $ref: Tag, nullable: true } }
      maybe: MaybeId
  Tag: { type: object, properties: { name: { type: string } } }
  MaybeId: { type: string, format: uuid, nullable: true }
`);

  test("optional comes from required, nullable moves from the use to the property", () => {
    expect(run.diagnostics).toEqual([]);
    const flags = (name: string) => {
      const p = propertyOf(run, "Article", name);

      return [p?.optional, p?.nullable];
    };

    expect(flags("title")).toEqual([false, false]);
    expect(flags("summary")).toEqual([false, true]);
    expect(flags("publishOn")).toEqual([true, true]);
    expect(flags("maybe")).toEqual([true, true]);
    expect(typeOf(run, "Article", "publishOn")).toEqual({
      kind: "scalar",
      type: "string",
      format: "date",
      refinements: {},
    });
    expect(typeOf(run, "Article", "tags")).toEqual({
      kind: "array",
      items: { kind: "ref", schema: "Tag", nullable: true },
    });
  });

  test("a nullable alias of an object, map or scalar keeps nullable at each use", () => {
    const aliases = schemas(`
  Foo: { type: object, properties: { a: { type: string } } }
  Labels: { type: object, additionalProperties: { type: string } }
  Id: { type: string, format: uuid }
  MaybeFoo: { $ref: Foo, nullable: true }
  MaybeMaybeFoo: MaybeFoo
  MaybeLabels: { $ref: Labels, nullable: true }
  MaybeId: { $ref: Id, nullable: true }
  Holder:
    type: object
    required: [foo, deep, labels, id]
    properties:
      foo: MaybeFoo
      deep: MaybeMaybeFoo
      labels: MaybeLabels
      id: MaybeId
      list: { type: array, items: MaybeFoo }
`);

    expect(aliases.diagnostics).toEqual([]);

    for (const name of ["foo", "deep", "labels", "id"])
      expect([name, propertyOf(aliases, "Holder", name)?.nullable]).toEqual([name, true]);
    expect(typeOf(aliases, "Holder", "foo")).toEqual({ kind: "ref", schema: "Foo" });
    expect(typeOf(aliases, "Holder", "list")).toEqual({
      kind: "array",
      items: { kind: "ref", schema: "Foo", nullable: true },
    });
  });

  test("a nullable alias of an object is refused as a union variant", () => {
    const run = schemas(`
  Foo: { type: object, properties: { a: { type: string } } }
  MaybeFoo: { $ref: Foo, nullable: true }
  U: { discriminator: k, oneOf: { a: MaybeFoo } }
`);

    expect(treeSchemasRules(run)).toEqual(["union-variant"]);
    expect(run.diagnostics[0]?.message).toContain("nullable");
  });
});

describe("marks", () => {
  const run = schemas(`
  Account:
    type: object
    typeName: acme:Account
    title: An account
    required: [name]
    properties:
      name: { type: string, description: The display name., deprecated: true }
      class: { type: string, codeName: kind }
      secret: Secret
      note: { type: string, restrictedTo: { right: notes.read, params: { level: 2 }, input: strip } }
      effort: { type: integer, restrictedTo: tasks.seeEffort }
      locale: { type: string, default: en }
  Secret: { type: string, sensitive: true }
`);

  test("each mark compiles to its property member", () => {
    expect(run.diagnostics).toEqual([]);
    expect(schemaOf(run, "Account")).toMatchObject({
      typeName: "acme:Account",
      docs: { summary: "An account" },
    });
    expect(propertyOf(run, "Account", "name")).toMatchObject({
      deprecated: true,
      docs: { description: "The display name." },
    });
    expect(propertyOf(run, "Account", "class")?.codeName).toEqual({
      segments: ["kind"],
      role: "member",
    });
    expect(propertyOf(run, "Account", "secret")?.sensitive).toBe(true);
    expect(propertyOf(run, "Account", "note")?.restrictedTo).toEqual({
      right: "notes.read",
      params: { level: 2 },
      inputPolicy: "strip",
      origin: at("/schemas/Account/properties/note/restrictedTo"),
    });
    expect(propertyOf(run, "Account", "effort")?.restrictedTo?.right).toBe("tasks.seeEffort");
    expect(propertyOf(run, "Account", "locale")?.default).toBe("en");
  });

  test.each([
    [
      "A: { type: object, required: [b], properties: { b: { type: string, restrictedTo: r } } }",
      "required-property",
    ],
    [
      "A: { type: object, required: [b], properties: { b: { type: string, default: x } } }",
      "required-property",
    ],
    ["A: { type: string, codeName: a }", "mark-position"],
    ["A: { type: array, items: { type: string, default: x } }", "mark-position"],
    [
      "A: { type: object, properties: { b: { type: object, typeName: x, properties: { c: { type: string } } } } }",
      "mark-position",
    ],
    ["A: { type: object, properties: { b: { type: string, codeName: '--' } } }", "name-segments"],
  ])("%s is refused (%s)", (yaml, rule) => {
    expect(treeSchemasRules(schemas(`  ${yaml}`))).toContain(rule);
  });
});

describe("annotations the contract model cannot hold are refused, not dropped", () => {
  test("annotations on a property and on named schemas are kept", () => {
    const run = schemas(`
  A:
    type: object
    examples: [{ b: { c: x } }]
    properties:
      b: { type: object, deprecated: true, description: B., examples: [{ c: x }], properties: { c: { type: string } } }
      d: { type: string, deprecated: true, title: D }
`);

    expect(run.diagnostics).toEqual([]);
    expect(schemaOf(run, "A")?.examples).toEqual([{ b: { c: "x" } }]);
    expect(schemaOf(run, "AB")).toMatchObject({
      examples: [{ c: "x" }],
      docs: { description: "B." },
    });
    expect(propertyOf(run, "A", "b")).toMatchObject({ deprecated: true });
    expect(propertyOf(run, "A", "d")).toMatchObject({ deprecated: true, docs: { summary: "D" } });
  });

  test("a schema's deprecation, property examples, variant docs and nested docs and examples are kept", () => {
    const run = schemas(`
  A:
    type: object
    deprecated: true
    properties:
      b: { type: string, examples: [x] }
      c: { $ref: B, examples: [{ d: why }] }
      list: { type: array, items: { type: string, description: An item., examples: [z] } }
      table: { type: object, additionalProperties: { type: integer, title: A count } }
  B: { type: object, properties: { d: { type: string } } }
  U: { discriminator: k, oneOf: { a: { $ref: B, description: A variant. } } }
`);

    expect(run.diagnostics).toEqual([]);
    expect(schemaOf(run, "A")?.deprecated).toBe(true);
    expect(schemaOf(run, "B")?.deprecated).toBeUndefined();
    expect(propertyOf(run, "A", "b")?.examples).toEqual(["x"]);
    expect(propertyOf(run, "A", "c")?.examples).toEqual([{ d: "why" }]);
    expect(typeOf(run, "A", "list")).toMatchObject({
      items: { docs: { description: "An item." }, examples: ["z"] },
    });
    expect(schemaOf(run, "ATable")).toMatchObject({ values: { docs: { summary: "A count" } } });
    expect(schemaOf(run, "U")).toMatchObject({
      variants: [{ tag: "a", schema: "B", docs: { description: "A variant." } }],
    });
  });

  test.each([
    ["A: { type: string, deprecated: true }", "deprecated"],
    ["A: { type: string, examples: [x] }", "examples"],
    ["A: { type: array, items: { type: string, deprecated: true } }", "deprecated"],
    ["A: { type: string, format: uuid, description: An id. }", "description"],
    ["A: { type: array, items: { type: string }, title: Tags }", "title"],
    [
      "A: { $ref: B, description: An alias. }\n  B: { type: object, properties: { c: { type: string } } }",
      "description",
    ],
    [
      "A: { allOf: [B, { type: object, description: More., properties: { d: { type: string } } }] }\n  B: { type: object, properties: { c: { type: string } } }",
      "description",
    ],
    [
      "A: { allOf: [{ type: object, examples: [{ d: x }], properties: { d: { type: string } } }] }",
      "examples",
    ],
    [
      "A: { allOf: [{ type: object, deprecated: true, properties: { d: { type: string } } }] }",
      "deprecated",
    ],
  ])("%s is refused, naming '%s'", (yaml, member) => {
    const run = schemas(`  ${yaml}`);

    expect(treeSchemasRules(run)).toEqual(["annotation-position"]);
    expect(run.diagnostics[0]?.message).toContain(`'${member}'`);
    expect(run.diagnostics[0]?.origin.pointer).toMatch(new RegExp(`/${member}$`));
  });

  test("docs on a route position schema are refused", () => {
    const run = treeSchemasRunApi(`schemas:
  Item: { type: object, properties: { id: { type: string } } }
surfaces:
  app:
    routes:
      inline:
        method: post
        output: { type: array, items: Item, description: The items. }
`);

    expect(treeSchemasRules(run)).toEqual(["annotation-position"]);
    expect(run.diagnostics[0]?.origin.pointer).toBe(
      "/surfaces/app/routes/inline/output/description",
    );
  });
});

describe("portable and named formats", () => {
  const run = treeSchemasRunApi(`scalars:
  money: { type: string, pattern: '^-?(0|[1-9][0-9]*)\\.[0-9]{2}$', description: An amount. }
schemas:
  Price:
    type: object
    properties:
      amount: { format: money, maxLength: 20 }
      big: { type: integer, format: int64, minimum: -5, maximum: 9007199254740991 }
      exact: { type: string, format: decimal, minimum: 0.5, multipleOf: 0.0000001 }
`);

  test("a named format holds its type and refinements inline and names its scalar", () => {
    expect(run.diagnostics).toEqual([]);
    expect(run.draft.scalars.money).toEqual({
      id: "money",
      name: { segments: ["money"], role: "schema" },
      type: {
        kind: "scalar",
        type: "string",
        refinements: {
          pattern: {
            source: "^-?(0|[1-9][0-9]*)\\.[0-9]{2}$",
            normalized: "^-?(0|[1-9][0-9]*)\\.[0-9]{2}$",
          },
        },
      },
      directions: [],
      docs: { description: "An amount." },
      origin: at("/scalars/money"),
    });
    expect(typeOf(run, "Price", "amount")).toMatchObject({
      kind: "scalar",
      type: "string",
      scalar: "money",
      refinements: { maxLength: 20, pattern: { source: "^-?(0|[1-9][0-9]*)\\.[0-9]{2}$" } },
    });
    expect(typeOf(run, "Price", "big")).toEqual({
      kind: "scalar",
      type: "integer",
      format: "int64",
      refinements: { minimum: "-5", maximum: "9007199254740991" },
    });
    expect(typeOf(run, "Price", "exact")).toMatchObject({
      refinements: { minimum: "0.5", multipleOf: "0.0000001" },
    });
  });

  test.each([
    ["A: { format: email }", "format-type"],
    ["A: { type: integer, format: uuid }", "format-type"],
    ["A: { type: string, format: password }", "format-type"],
    ["A: { type: string, format: nowhere }", "format-unknown"],
    ["A: { type: number, multipleOf: 0.1 }", "refinement-type"],
    ["A: { type: integer, maxLength: 3 }", "refinement-type"],
    ["A: { type: string, minimum: 1 }", "refinement-type"],
    ["A: { type: integer, maximum: 9007199254740993 }", "refinement-precision"],
    ["A: { type: string, pattern: '(?=a)' }", "pattern"],
    [
      "A: { type: string, format: decimal, minimum: 0.12345678901234567890123 }",
      "refinement-precision",
    ],
    ["A: { type: number, maximum: 123456789012.345678 }", "refinement-precision"],
    ["A: { type: string, minLength: 5, maxLength: 2 }", "refinement-range"],
    ["A: { type: integer, minimum: 10, maximum: 1 }", "refinement-range"],
    ["A: { type: integer, exclusiveMinimum: 1, maximum: 1 }", "refinement-range"],
    ["A: { type: integer, exclusiveMinimum: 1, exclusiveMaximum: 2 }", "refinement-range"],
    ["A: { type: integer, minimum: 1.2, maximum: 1.8 }", "refinement-range"],
    [
      "A: { type: string, format: decimal, minimum: 2.5, exclusiveMaximum: 2.5 }",
      "refinement-range",
    ],
    ["A: { type: array, items: { type: string }, minItems: 4, maxItems: 1 }", "refinement-range"],
  ])("%s is refused (%s)", (yaml, rule) => {
    expect(treeSchemasRules(schemas(`  ${yaml}`))).toContain(rule);
  });

  test.each([
    ["uuid", "scalar-name"],
    ["password", "scalar-name"],
  ])("a scalar named %s is refused, the fix naming the portable spelling", (name, rule) => {
    const result = treeSchemasRunApi(`scalars:\n  ${name}: { type: string }`);

    expect(treeSchemasRules(result)).toEqual([rule]);
    expect(result.diagnostics[0]?.fix).toContain(
      name === "uuid" ? "type: string, format: uuid" : "sensitive",
    );
  });

  test("bounds that leave room for one value are kept; a named format's merged bounds are checked", () => {
    const fits = schemas("  A: { type: integer, minimum: 1, maximum: 1 }");

    expect(fits.diagnostics).toEqual([]);
    const oneInteger = schemas("  A: { type: integer, exclusiveMinimum: 1, exclusiveMaximum: 3 }");

    expect(oneInteger.diagnostics).toEqual([]);
    const fraction = schemas("  A: { type: number, exclusiveMinimum: 1, exclusiveMaximum: 2 }");

    expect(fraction.diagnostics).toEqual([]);
    const noInteger = schemas("  A: { type: integer, exclusiveMinimum: 1, exclusiveMaximum: 2 }");

    expect(noInteger.diagnostics[0]?.message).toContain(
      "no integer lies between 'exclusiveMinimum' 1 and 'exclusiveMaximum' 2",
    );
    const merged = treeSchemasRunApi(
      "scalars:\n  code: { type: string, minLength: 5 }\nschemas:\n  A: { format: code, maxLength: 2 }",
    );

    expect(treeSchemasRules(merged)).toEqual(["refinement-range"]);
    expect(merged.diagnostics[0]?.message).toContain("'minLength' 5 is above 'maxLength' 2");
  });

  test("a named format beside a type is refused", () => {
    const result = treeSchemasRunApi(
      "scalars:\n  money: { type: string }\nschemas:\n  A: { type: string, format: money }",
    );

    expect(result.diagnostics.map((d) => [d.rule, d.fix])).toEqual([
      ["seampact/tree/format-type", "remove 'type' and write 'format: money' alone"],
    ]);
  });
});

describe("hoisted names", () => {
  const run = treeSchemasRunApi(`schemas:
  Order:
    type: object
    properties:
      address: { type: object, properties: { city: { type: string } } }
      lines: { type: array, items: { type: object, properties: { sku: { type: string } } } }
      extras: { type: object, additionalProperties: { type: object, properties: { x: { type: string } } } }
rights:
  tasks.update: { params: { level?: { type: integer }, scope: { type: object, properties: { id: { type: string } } } } }
rules:
  recentAuth: { params: Order }
errors:
  '404-gone': { status: 410, params: { at: { type: string } } }
`);

  test("an inline schema takes the name of its position (ADR 0007 section 3)", () => {
    expect(run.diagnostics).toEqual([]);
    const names = Object.fromEntries(
      Object.values(run.draft.schemas)
        .filter((schema) => schema.origin.layer !== "core")
        .map((schema) => [schema.id, schema.name]),
    );

    expect(names).toEqual({
      OrderAddress: { segments: ["order", "address"], role: "property" },
      OrderLinesItem: { segments: ["order", "lines"], role: "item" },
      OrderExtrasValue: { segments: ["order", "extras"], role: "value" },
      OrderExtras: { segments: ["order", "extras"], role: "property" },
      Order: { segments: ["order"], role: "schema" },
      TasksUpdateParamsScope: {
        segments: ["tasks", "update", "params", "scope"],
        role: "property",
      },
      TasksUpdateParams: { segments: ["tasks", "update"], role: "params" },
      _404GoneParams: { segments: ["404", "gone"], role: "params" },
    });
    expect(propertyOf(run, "TasksUpdateParams", "level")?.optional).toBe(true);
    expect(run.service.typeUse("/rules/recentAuth/params", "input")).toEqual({
      kind: "ref",
      schema: "Order",
    });
  });

  test.each([
    [
      "schemas:\n  A: { type: object, properties: { b: { type: object, properties: { c: { type: string } } } } }\n  AB: { type: string }",
      "name-collision",
    ],
    ["schemas:\n  TaskID: { type: string }\n  TaskId: { type: string }", "name-collision"],
    [
      "schemas:\n  A: { type: object, properties: { userId: { type: string }, user_id: { type: string } } }",
      "name-collision",
    ],
    [
      "rights:\n  r: { params: { a: { type: string } } }\nschemas:\n  RParams: { type: string }",
      "name-collision",
    ],
    ["rights:\n  r: { params: Missing }", "schema-unknown"],
    [
      "rules:\n  r: { params: Tags }\nschemas:\n  Tags: { type: array, items: { type: string } }",
      "fields-schema",
    ],
    [
      "identities:\n  u: { schemes: { read: [], write: [] }, principal: { type: object, properties: { a: { type: string } } } }",
      "schema-inline",
    ],
  ])("%s is refused (%s)", (yaml, rule) => {
    const result = treeSchemasRunApi(yaml);

    expect(treeSchemasRules(result)).toContain(rule);
  });

  test("a hoisted name is compared with declared names by identifier, not spelling", () => {
    const result = treeSchemasRunApi(`schemas:
  Order: { type: object, properties: { address: { type: object, properties: { city: { type: string } } } } }
  ORDERAddress: { type: object, properties: { street: { type: string } } }
`);

    expect(result.diagnostics.map((d) => [d.rule, d.fix, d.related[0]?.message])).toEqual([
      [
        "seampact/tree/name-collision",
        "rename the schema or the property",
        "'ORDERAddress' is named here",
      ],
    ]);
  });

  test("two hoisted names with one identifier collide", () => {
    const result = treeSchemasRunApi(`schemas:
  A:
    type: object
    properties:
      b: { type: object, properties: { c: { type: object, properties: { x: { type: string } } } } }
      bC: { type: object, properties: { z: { type: string } } }
`);

    expect(treeSchemasRules(result)).toEqual(["name-collision"]);
  });
});

describe("schema service", () => {
  const run = treeSchemasRunApi(`schemas:
  Item: { type: object, properties: { id: Id } }
  Id: { type: string, format: uuid }
surfaces:
  app:
    routes:
      items:
        kind: collection
        id: { itemId: Id }
        item: Item
        ops: { create: { input: Item } }
      inline:
        method: post
        input: { type: object, properties: { a: { type: string } } }
        headers: { X-Trace: { type: string } }
        output: { type: array, items: Item }
`);
  const items = "/surfaces/app/routes/items";
  const inline = "/surfaces/app/routes/inline";

  test("a declaration or route position answers its use, an inline route object its hoisted schema", () => {
    expect(run.diagnostics).toEqual([]);
    const uuid = { kind: "scalar", type: "string", format: "uuid", refinements: {} };

    expect(run.service.typeUse("/schemas/Item", "output")).toEqual({ kind: "ref", schema: "Item" });
    expect(run.service.typeUse("/schemas/Id", "input")).toEqual(uuid);
    expect(run.service.typeUse(`${items}/id/itemId`, "input")).toEqual(uuid);
    expect(run.service.typeUse(`${items}/item`, "output")).toEqual({ kind: "ref", schema: "Item" });
    expect(run.service.typeUse(`${items}/ops/create/input`, "input")).toEqual({
      kind: "ref",
      schema: "Item",
    });
    expect(run.service.typeUse(`${inline}/headers/X-Trace`, "input")).toMatchObject({
      kind: "scalar",
    });
    expect(run.service.typeUse(`${inline}/output`, "output")).toEqual({
      kind: "array",
      items: { kind: "ref", schema: "Item" },
    });
    expect(run.service.typeUse(`${inline}/input`, "input")).toEqual({
      kind: "ref",
      schema: "InlineInput",
    });
    expect(run.service.typeUse(`${items}/kind`, "input")).toBeUndefined();
  });

  test("each answer is a new copy, and the service survives the run's draft", () => {
    const first = run.service.typeUse(`${items}/item`, "output");

    if (first?.kind === "ref") first.schema = "Changed";
    expect(run.service.typeUse(`${items}/item`, "output")).toEqual({ kind: "ref", schema: "Item" });
    expect(run.service.queryWire(`${items}/item`)).toBeUndefined();
  });
});

describe("tree.schemas diagnostics are located", () => {
  test("every diagnostic has its rule, message, fix and a located origin", () => {
    const run = treeSchemasRunApi(`scalars:
  uuid: { type: string }
schemas:
  A: { type: object, properties: { b: Missing, c: { format: email }, d: { type: string, pattern: '\\b' } } }
  B: { type: object, properties: { x: { type: string }, X: { type: string } } }
  U: { discriminator: k, oneOf: { a: B, b: { type: string } } }
`);

    expect(new Set(treeSchemasRules(run))).toEqual(
      new Set([
        "scalar-name",
        "schema-unknown",
        "format-type",
        "pattern",
        "name-collision",
        "union-variant",
      ]),
    );
    expect(run.located).toBe(true);

    for (const d of run.diagnostics) {
      expect(d.rule).toMatch(/^seampact\/tree\/[a-z-]+$/);
      expect(d.severity).toBe("error");
      expect(d.message.length).toBeGreaterThan(0);
      expect(d.fix.length).toBeGreaterThan(0);
    }

    const collision = run.diagnostics.find((d) => d.rule === "seampact/tree/name-collision");

    expect(collision?.related).toEqual([
      { origin: at("/schemas/B/properties/x"), message: "'x' is here" },
    ]);
  });
});
