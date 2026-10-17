import { expect, test } from "vitest";
import type { AuthoringFile } from "./schemas.js";
import { authoringAjv, schemaId } from "./test-ajv.js";

// SCN-046: the authoring schemas reject a misspelt key; a few refusals each grammar area relies on.
const ajv = authoringAjv();

function errors(file: AuthoringFile, doc: unknown): string[] {
  const validate = ajv.getSchema(schemaId(file));
  if (validate === undefined) throw new Error(file);
  validate(doc);
  return (validate.errors ?? [])
    .filter((e) => e.keyword !== "if")
    .map((e) => `${e.keyword} ${e.instancePath}`);
}

const api = (routes: unknown) => ({
  api: { name: "tasks", version: 1 },
  surfaces: { app: { identity: "user", routes } },
});

test.each([
  [
    "a misspelt route key",
    "api",
    api({ health: { method: "get", ouput: "Health" } }),
    "additionalProperties /surfaces/app/routes/health",
  ],
  [
    "a misspelt top-level key",
    "api",
    { api: { name: "a", version: 1 }, surface: {} },
    "additionalProperties ",
  ],
  [
    "a node without a kind",
    "api",
    api({ health: { output: "Health" } }),
    "required /surfaces/app/routes/health",
  ],
  ["a refused schema keyword", "schemas", { Task: { type: "object", if: {} } }, "not /Task/if"],
  ["an inline enum", "schemas", { Task: { enum: ["a", "b"] } }, "not /Task/enum"],
  [
    "a public access without a reason",
    "api",
    api({ h: { method: "get", access: { public: "" } } }),
    "minLength /surfaces/app/routes/h/access/public",
  ],
  [
    "a guest right without a reason",
    "rights",
    { "tasks.read": { guest: true } },
    "type /tasks.read/guest",
  ],
  ["an opaque value without a reason", "schemas", { Blob: { opaque: null } }, "type /Blob/opaque"],
  [
    "an unknownQuery ignore without a reason",
    "node",
    { method: "get", unknownQuery: "ignore" },
    "enum /unknownQuery",
  ],
  ["a schema name in lower case", "schemas", { task: { type: "string" } }, "propertyNames "],
  ["a reserved extension prefix", "rights", { r: { "x-seampact-a": 1 } }, "not /r/x-seampact-a"],
  [
    "code in a pack",
    "pack",
    { pack: { name: "p", version: "1.0.0" }, script: "./index.js" },
    "additionalProperties ",
  ],
  [
    "$include in routes",
    "api",
    api({ $include: "./r.yaml" }),
    "propertyNames /surfaces/app/routes",
  ],
  [
    "a service api without a caller",
    "api",
    { api: { name: "billing", version: 1, kind: "service" } },
    "required /api",
  ],
] as const)("rejects %s", (_, file, doc, expected) => {
  expect(errors(file, doc)).toContain(expected);
});

test("accepts a service api with a caller or an included fragment, and a product api without one", () => {
  const caller = { identity: "service", right: "callerService" };

  expect(errors("api", { api: { name: "b", version: 1, kind: "service", caller } })).toEqual([]);
  expect(
    errors("api", { api: { name: "b", version: 1, kind: "service", $include: "./a.yaml" } }),
  ).toEqual([]);
  expect(errors("api", { api: { name: "b", version: 1, kind: "product" } })).toEqual([]);
});

test("accepts the six non-safety departures without a reason (CHK-142)", () => {
  expect(
    errors("api", {
      api: { name: "tasks", version: 1 },
      conventions: { pathVersion: "none" },
      enums: { Role: { values: ["owner"] } },
      schemas: {
        State: { type: "object", properties: { s: { enum: { narrow: "Role", to: ["owner"] } } } },
      },
      surfaces: {
        app: {
          pathVersion: "none",
          identity: "user",
          routes: {
            list: {
              method: "get",
              item: "Task",
              paging: "none",
              format: "bare",
              maturity: "experimental",
            },
          },
        },
      },
    }),
  ).toEqual([]);
});

const pack = (derive: unknown) => ({ pack: { name: "p", version: "1.0.0" }, derive: [derive] });
const workspace = (entry: unknown) => ({ workspace: { imports: { billing: entry } } });
const pinned = { api: "billing", integrity: "sha256-x" };

test.each([
  [
    "a derive require without right or rule",
    "pack",
    pack({ entry: "e", select: {}, require: {} }),
    "required /derive/0/require",
  ],
  [
    "a derive require with right and bucket",
    "pack",
    pack({ entry: "e", select: {}, require: { right: "{resource}.{op}", bucket: "b" } }),
    "not /derive/0/require/bucket",
  ],
  [
    "a derive require with right and params",
    "pack",
    pack({ entry: "e", select: {}, require: { right: "{resource}.{op}", params: {} } }),
    "not /derive/0/require/params",
  ],
  [
    "an import without a source",
    "workspace",
    workspace(pinned),
    "required /workspace/imports/billing",
  ],
  [
    "an import with two sources",
    "workspace",
    workspace({ ...pinned, package: "@acme/c", version: "1.0.0", release: { url: "https://x" } }),
    "not /workspace/imports/billing/release",
  ],
  [
    "an import package without its version",
    "workspace",
    workspace({ ...pinned, package: "@acme/c" }),
    "required /workspace/imports/billing",
  ],
  [
    "an import version without a package",
    "workspace",
    workspace({ ...pinned, git: { url: "https://x", tag: "v1" }, version: "1.0.0" }),
    "not /workspace/imports/billing/version",
  ],
  [
    "an import with release and git",
    "workspace",
    workspace({ ...pinned, release: { url: "https://x" }, git: { url: "https://x", tag: "v1" } }),
    "not /workspace/imports/billing/git",
  ],
  [
    "a path with a control character",
    "api",
    { api: { name: "a", version: 1 }, extends: "./a\u0001.yaml" },
    "pattern /extends",
  ],
  [
    "an include path with a newline",
    "node",
    { method: "get", $include: "./a\n.yaml" },
    "pattern /$include",
  ],
  [
    "a path with a bidi control",
    "api",
    { api: { name: "a", version: 1 }, extends: "./a\u202E.yaml" },
    "pattern /extends",
  ],
  [
    "a pointer with a line separator",
    "node",
    { method: "get", $include: "./a.yaml#/b\u2028" },
    "pattern /$include",
  ],
  [
    "a pack reference with a C1 control",
    "base",
    { packs: ["@acme/pack\u0085"] },
    "pattern /packs/0",
  ],
  ["a right name with a bidi isolate", "rights", { "tasks\u2066.read": {} }, "propertyNames "],
  [
    "a requirement with a right and a bucket",
    "node",
    { method: "get", requires: [{ right: "tasks.read", bucket: "b" }] },
    "not /requires/0/bucket",
  ],
  [
    "a paging mapping with two styles beside $include",
    "node",
    { method: "get", paging: { $include: "./p.yaml", cursor: {}, offset: {} } },
    "maxProperties /paging",
  ],
] as const)("rejects %s", (_, file, doc, expected) => {
  expect(errors(file, doc)).toContain(expected);
});

// ADR 0002 section 2: `$include` may be a key of any mapping but `routes`.
test.each([
  ["ops", "node", { kind: "collection", ops: { $include: "./ops.yaml" } }],
  ["responses", "node", { method: "get", responses: { $include: "./r.yaml" } }],
  ["a response", "node", { method: "get", responses: { 200: { $include: "./r.yaml" } } }],
  ["bindings", "node", { method: "get", bindings: { $include: "./b.yaml" } }],
  ["a paging mapping", "node", { method: "get", paging: { $include: "./p.yaml" } }],
  [
    "a paging style's settings",
    "node",
    { method: "get", paging: { cursor: { $include: "./p.yaml" } } },
  ],
  ["a maturity mapping", "node", { method: "get", maturity: { $include: "./m.yaml" } }],
  ["a union's variants", "schema", { oneOf: { $include: "./v.yaml" } }],
  ["an enum narrowing", "schema", { enum: { $include: "./n.yaml" } }],
  ["a pick", "schema", { pick: { $include: "./p.yaml" } }],
  ["codeNames", "enums", { State: { values: ["a"], codeNames: { $include: "./c.yaml" } } }],
  [
    "identity variants",
    "identities",
    { user: { principal: { variants: { $include: "./v.yaml" } } } },
  ],
  [
    "a role binding",
    "conventions",
    { errors: { derived: { forbidden: { $include: "./f.yaml" } } } },
  ],
  [
    "an unknown keys exception",
    "schema",
    { type: "object", unknownKeys: { $include: "./u.yaml" } },
  ],
  ["an import source", "workspace", workspace({ ...pinned, release: { $include: "./r.yaml" } })],
  ["a node fragment of an unknown kind", "node", { $include: "./n.yaml", output: "Task" }],
  [
    "an import package (the version may be included)",
    "workspace",
    workspace({ ...pinned, package: "@acme/c", $include: "./v.yaml" }),
  ],
  [
    "a paging mapping beside its one style",
    "node",
    { method: "get", paging: { $include: "./p.yaml", cursor: { maxLimit: 50 } } },
  ],
] as const)("accepts $include in %s", (_, file, doc) => {
  expect(errors(file, doc)).toEqual([]);
});

test.each([
  [
    "a node fragment with a key no node has",
    "node",
    { $include: "./n.yaml", ouput: "Task" },
    "additionalProperties ",
  ],
  [
    "$include in routes",
    "node",
    { kind: "single", routes: { $include: "./r.yaml" } },
    "propertyNames /routes",
  ],
] as const)("rejects %s", (_, file, doc, expected) => {
  expect(errors(file, doc)).toContain(expected);
});

// The derive entry's effect is stated on the effect keys (ADR 0002 section 2).
test.each([
  [
    "a missing select is not also a missing effect",
    { entry: "e", attachErrors: [] },
    ["required "],
  ],
  [
    "an unknown key is not an effect",
    { entry: "e", select: {}, bogus: 1 },
    ["required ", "additionalProperties "],
  ],
] as const)("derive entry: %s", (_, entry, expected) => {
  const validate = ajv.getSchema(schemaId("pack"));
  if (validate === undefined) throw new Error("pack");
  validate(pack(entry));
  expect(
    (validate.errors ?? [])
      .filter((e) => e.keyword !== "if")
      .map((e) => `${e.keyword} ${e.instancePath.replace("/derive/0", "")}`),
  ).toEqual(expected);
});

test("a derived object accepts nullable, deprecated and examples", () => {
  const derived = {
    pick: { from: "Task", fields: ["title"] },
    nullable: true,
    deprecated: true,
    examples: [{ title: "a" }],
  };
  expect(errors("schema", derived)).toEqual([]);
});

test.each([
  [
    "a property",
    "schema",
    '{ "type": "object", "properties": { "__proto__": { "type": "string" } } }',
    "propertyNames /properties",
  ],
  [
    "a field",
    "node",
    '{ "method": "get", "query": { "constructor": "Task" } }',
    "propertyNames /query",
  ],
  ["a right", "rights", '{ "prototype": {} }', "propertyNames "],
  [
    "a right name in use",
    "node",
    '{ "method": "get", "filteredBy": "__proto__" }',
    "not /filteredBy",
  ],
  [
    "a right name in use",
    "node",
    '{ "method": "get", "filteredBy": "constructor" }',
    "not /filteredBy",
  ],
  [
    "a route name",
    "node",
    '{ "kind": "single", "routes": { "constructor": { "method": "get" } } }',
    "propertyNames /routes",
  ],
  ["a catalogue name", "buckets", '{ "prototype": { "limit": 1, "per": "1m" } }', "propertyNames "],
  [
    "a paging style name",
    "node",
    '{ "method": "get", "paging": { "constructor": {} } }',
    "propertyNames /paging",
  ],
  [
    "an extension prefix",
    "base",
    '{ "extensions": { "prototype": {} } }',
    "propertyNames /extensions",
  ],
  [
    "an extension key",
    "base",
    '{ "extensions": { "acme": { "constructor": { "at": ["route"] } } } }',
    "propertyNames /extensions/acme",
  ],
] as const)("refuses a reserved name as %s", (_, file, json, expected) => {
  expect(errors(file, JSON.parse(json))).toContain(expected);
});

test("one source form per import is accepted", () => {
  for (const source of [
    { package: "@acme/c", version: "2.3.0" },
    { release: { url: "https://x" } },
    { git: { url: "https://x", tag: "v1", directory: "contracts" } },
  ]) {
    expect(errors("workspace", workspace({ ...pinned, ...source }))).toEqual([]);
  }
});
