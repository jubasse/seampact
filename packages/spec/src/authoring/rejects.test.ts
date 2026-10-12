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
] as const)("rejects %s", (_, file, doc, expected) => {
  expect(errors(file, doc)).toContain(expected);
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
