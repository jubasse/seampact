import { AUTHORING_FILES, authoringSchemas, type JsonSchema } from "@seampact/spec/authoring";
import { describe, expect, test } from "vitest";
import {
  IGNORED_KEYWORDS,
  POSITION_KEYWORDS,
  type Position,
  positionOf,
  stepPosition,
} from "./positions.js";

const types = (pos: Position | undefined) => (pos?.types ? [...pos.types].sort() : pos?.types);
const keyOf = (schema: JsonSchema, key: string) => stepPosition(positionOf(schema), key, false);

const closed = (props: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties: props,
  additionalProperties: false,
});

// `if`/`then`/`else` without a `then` literal, which Biome reads as a thenable.
const when = (cond: JsonSchema, yes?: JsonSchema, no?: JsonSchema): JsonSchema =>
  Object.fromEntries([
    ["if", cond],
    ...(yes ? [["then", yes]] : []),
    ...(no ? [["else", no]] : []),
  ]);

describe("alternatives", () => {
  test("a key one alternative types and another leaves free is unknown", () => {
    const schema = { anyOf: [closed({ x: { type: "string" } }), { type: "object" }] };
    expect(keyOf(schema, "x")).toBeUndefined();
  });

  test("the same through then and else, and through oneOf", () => {
    const open = { type: "object", additionalProperties: {} };
    expect(
      keyOf(when({ required: ["y"] }, closed({ x: { type: "string" } })), "x"),
    ).toBeUndefined();
    expect(keyOf({ oneOf: [closed({ x: { type: "string" } }), open] }, "x")?.types).toBe(undefined);
  });

  test("closed alternatives type a key by their union", () => {
    const schema = {
      anyOf: [closed({ x: { type: "string" } }), closed({ x: { type: "integer" } })],
    };
    expect(types(keyOf(schema, "x"))).toEqual(["integer", "string"]);
  });

  test("an alternative that cannot hold a key is dropped", () => {
    const schema = {
      anyOf: [{ type: "string" }, closed({ x: { type: "integer" } }), closed({ y: {} })],
    };
    expect(types(keyOf(schema, "x"))).toEqual(["integer"]);
  });

  test("an if on the value's type is chosen when a key is read", () => {
    const schema = when({ type: "string" }, { type: "string" }, closed({ x: { type: "boolean" } }));
    expect(types(keyOf(schema, "x"))).toEqual(["boolean"]);
  });
});

describe("constraints that hold together", () => {
  test("a rule beside the properties types nothing away", () => {
    const schema = { ...closed({ x: { type: "string" } }), allOf: [{ required: ["x"] }] };
    expect(types(keyOf(schema, "x"))).toEqual(["string"]);
  });

  test("a key a conflict marker forbids in a case that holds is impossible", () => {
    const schema = {
      ...closed({ x: { type: "string" } }),
      allOf: [{ properties: { x: { title: "conflict", not: {} } } }],
    };
    expect(keyOf(schema, "x")).toBeUndefined();
  });
});

describe("data positions", () => {
  test("only a node marked data is a data position", () => {
    expect(keyOf(closed({ x: { title: "data" } }), "x")?.data).toBe(true);
    expect(keyOf(closed({ x: { $comment: "ADR 0002 section 12" } }), "x")?.data).toBe(false);
    expect(keyOf(closed({ x: {} }), "x")?.data).toBe(false);
  });
});

// Every keyword the authoring schemas use, at schema positions.
function keywords(node: unknown, out: Set<string>): Set<string> {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    out.add(key);
    if (["properties", "patternProperties", "$defs", "dependentSchemas"].includes(key)) {
      for (const child of Object.values(value as object)) keywords(child, out);
    } else if (["allOf", "anyOf", "oneOf", "prefixItems"].includes(key)) {
      for (const child of value as unknown[]) keywords(child, out);
    } else if (
      ["not", "if", "then", "else", "items", "additionalProperties", "propertyNames"].includes(key)
    ) {
      keywords(value, out);
    }
  }
  return out;
}

// The reading is a bounded interpreter of the schemas (positions.ts): a keyword it neither models
// nor ignores on purpose could change where a key leads or what a scalar must be, unseen.
test("the authoring schemas use no keyword the position reading does not account for", () => {
  const used = new Set<string>();
  for (const file of AUTHORING_FILES) keywords(authoringSchemas()[file], used);
  const known = new Set([...POSITION_KEYWORDS, ...IGNORED_KEYWORDS]);
  expect([...used].filter((k) => !known.has(k)).sort()).toEqual([]);
  // The ignored list names only what the schemas use, so a new keyword is a decision made here.
  expect(IGNORED_KEYWORDS.filter((k) => !used.has(k))).toEqual([]);
});
