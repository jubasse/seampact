import { readFileSync, writeFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";
import type { JsonSchema } from "../authoring/schemas.js";
import { APP_CONFIG_SCHEMA } from "./app-config.js";
import { dslParityViolations } from "./dsl-parity.test-support.js";
import { ROOT_CONFIG_SCHEMA } from "./root-config.js";

// The committed config schemas under `schemas/config/`, by file name: the definition every runner validates, the
// Gradle and Maven DSLs included (A42), each written from its TypeScript constant.
const CONFIG_SCHEMA_FILES: Readonly<Record<string, JsonSchema>> = {
  "app.schema.json": APP_CONFIG_SCHEMA,
  "root.schema.json": ROOT_CONFIG_SCHEMA,
};

const SCHEMA_DIRECTORY = new URL("../../schemas/config/", import.meta.url);

const WRITE = process.env.SEAMPACT_WRITE_CONFIG_SCHEMAS === "1";

const FILE_NAMES = Object.keys(CONFIG_SCHEMA_FILES);

function schemaOf(fileName: string): JsonSchema {
  const schema = CONFIG_SCHEMA_FILES[fileName];

  if (schema === undefined) throw new Error(`no config schema named ${fileName}`);

  return schema;
}

// The committed files are the TypeScript constants; with the variable set the test rewrites them, then
// `pnpm biome format --write packages/core/spec/schemas/config` lays them out.
describe("committed config schemas", () => {
  test.each(FILE_NAMES)("%s equals its constant", (fileName) => {
    const file = new URL(fileName, SCHEMA_DIRECTORY);

    if (WRITE) writeFileSync(file, `${JSON.stringify(schemaOf(fileName), null, 2)}\n`);

    expect(
      JSON.parse(readFileSync(file, "utf8")),
      "run SEAMPACT_WRITE_CONFIG_SCHEMAS=1 to regenerate",
    ).toEqual(schemaOf(fileName));
  });

  // `strictRequired` off: a source form forbids the keys of the others with `not: { required }`.
  test.each(FILE_NAMES)("%s compiles in Ajv strict mode", (fileName) => {
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });

    expect(ajv.validateSchema(schemaOf(fileName))).toBe(true);
    expect(() => ajv.compile(schemaOf(fileName))).not.toThrow();
  });

  test.each(FILE_NAMES)("%s gives every form a Gradle and a Maven form", (fileName) => {
    expect(dslParityViolations(schemaOf(fileName))).toEqual([]);
  });
});

describe("the DSL parity walk", () => {
  test.each([
    {
      name: "a fixed key that is no identifier",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { "out-dir": { type: "string" } },
      },
      violation: "/properties/out-dir: a fixed key that is no identifier",
    },
    {
      name: "a map with free keys",
      schema: { type: "object", additionalProperties: { type: "string" } },
      violation: ": a map whose keys follow no name pattern",
    },
    {
      name: "an open object",
      schema: { type: "object", properties: { path: { type: "string" } } },
      violation: ": an object that neither fixes its keys nor is a map",
    },
    {
      name: "keys told apart by pattern",
      schema: { type: "object", patternProperties: { "^x-": { type: "string" } } },
      violation: ": keys told apart by pattern (patternProperties)",
    },
    {
      name: "a number told from a string",
      schema: { oneOf: [{ type: "integer" }, { type: "string" }] },
      violation: "/oneOf: branches 0 and 1 differ by neither JSON type nor a required key",
    },
    {
      name: "two strings told apart by pattern",
      schema: {
        oneOf: [
          { type: "string", pattern: "^a" },
          { type: "string", pattern: "^b" },
        ],
      },
      violation: "/oneOf: branches 0 and 1 differ by neither JSON type nor a required key",
    },
    {
      name: "two objects with the same required keys",
      schema: {
        oneOf: [
          { type: "object", additionalProperties: false, properties: { a: { type: "string" } } },
          { type: "object", additionalProperties: false, properties: { b: { type: "string" } } },
        ],
      },
      violation: "/oneOf: branches 0 and 1 differ by neither JSON type nor a required key",
    },
    {
      name: "a null value",
      schema: { type: "null" },
      violation: ": a null value, which only YAML writes",
    },
    {
      name: "an object open to any key",
      schema: { type: "object", additionalProperties: true },
      violation: ": an object open to any key",
    },
    {
      name: "properties without a type",
      schema: { properties: { a: { type: "string" } } },
      violation: ": properties on a value that is not typed an object",
    },
    {
      name: "a keyword the walk does not check",
      schema: { allOf: [{ oneOf: [{ type: "integer" }, { type: "string" }] }] },
      violation: ": the keyword 'allOf', which the parity walk does not check",
    },
    {
      name: "an enum of several JSON types",
      schema: { enum: ["1", 1] },
      violation: ": an enum of several JSON types",
    },
  ])("refuses $name", ({ schema, violation }) => {
    expect(dslParityViolations(schema)).toContain(violation);
  });

  test("accepts alternatives told apart by JSON type or by a required key", () => {
    const schema = {
      oneOf: [
        { type: "boolean" },
        {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
        {
          type: "object",
          propertyNames: { pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
          additionalProperties: { type: "string" },
        },
      ],
    };

    expect(dslParityViolations(schema)).toEqual([]);
  });
});
