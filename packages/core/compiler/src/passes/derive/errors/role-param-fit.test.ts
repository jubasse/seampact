import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { type DeriveErrorsFit, deriveErrorsMisfit } from "./role-param-fit.js";

const STRING_USE: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };

const COUNT_USE: IrWriter.TypeUse = { kind: "scalar", type: "integer", refinements: {} };

function property(name: string, type: IrWriter.TypeUse, optional: boolean): IrWriter.Property {
  return {
    name,
    type,
    optional,
    nullable: false,
    sensitive: false,
    deprecated: false,
    docs: {},
    extensions: {},
    origin: { layer: "api", pointer: `/schemas/${name}` },
  };
}

function objectSchema(id: string, properties: IrWriter.Property[]): IrWriter.Schema {
  return {
    kind: "object",
    id,
    name: { segments: [id], role: "schema" },
    properties,
    directions: [],
    examples: [],
    docs: {},
    extensions: {},
    origin: { layer: "api", pointer: `/schemas/${id}` },
  };
}

const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });

// The datum's `Holder` may leave `owner` out, which `Wanted` requires; `Counted` holds a count, not a string.
const fit: DeriveErrorsFit = {
  schemas: {
    Holder: objectSchema("Holder", [property("owner", STRING_USE, true)]),
    Wanted: objectSchema("Wanted", [property("owner", STRING_USE, false)]),
    Counted: objectSchema("Counted", [property("owner", COUNT_USE, false)]),
  },
  examples: { checkExample: () => [] },
};

describe("misfit reasons", () => {
  test("an optional member into a required one is an omittable reason, kept through the member", () => {
    expect(
      deriveErrorsMisfit(
        fit,
        { use: ref("Holder"), nullable: false },
        { use: ref("Wanted"), nullable: false },
      ),
    ).toEqual({
      kind: "omittable",
      text: "for its member 'owner', it may be left out, but the param requires it",
    });
  });

  test("a member of another type is a misfit reason", () => {
    expect(
      deriveErrorsMisfit(
        fit,
        { use: ref("Wanted"), nullable: false },
        { use: ref("Counted"), nullable: false },
      ),
    ).toMatchObject({ kind: "misfit" });
  });
});

function scalar(refinements: IrWriter.Refinements, format?: string): IrWriter.TypeUse {
  return {
    kind: "scalar",
    type: "string",
    ...(format === undefined ? {} : { format }),
    refinements,
  };
}

function enumUse(name: string, narrowedTo?: string[]): IrWriter.TypeUse {
  return {
    kind: "enum",
    enum: name,
    ...(narrowedTo === undefined ? {} : { narrowedTo: { values: narrowedTo } }),
  };
}

function array(items: IrWriter.TypeUse, bounds: { minItems?: number; maxItems?: number } = {}) {
  const use: IrWriter.TypeUse = { kind: "array", items, ...bounds };

  return use;
}

function misfitOf(
  rendered: IrWriter.TypeUse,
  accepted: IrWriter.TypeUse,
  nullability: { rendered?: boolean; accepted?: boolean } = {},
) {
  return deriveErrorsMisfit(
    fit,
    { use: rendered, nullable: nullability.rendered ?? false },
    { use: accepted, nullable: nullability.accepted ?? false },
  );
}

describe("a datum that fits its param", () => {
  test.each([
    ["the same enum", enumUse("Role"), enumUse("Role")],
    [
      "an enum narrowed to a subset of the param's narrowing",
      enumUse("Role", ["a"]),
      enumUse("Role", ["a", "b"]),
    ],
    ["a string of the same format", scalar({}, "uuid"), scalar({}, "uuid")],
    [
      "a longer minimum length than the param's",
      scalar({ minLength: 5 }),
      scalar({ minLength: 3 }),
    ],
    [
      "a shorter maximum length than the param's",
      scalar({ maxLength: 5 }),
      scalar({ maxLength: 9 }),
    ],
    [
      "the same pattern",
      scalar({ pattern: { source: "^a$", normalized: "^a$" } }),
      scalar({ pattern: { source: "^a$", normalized: "^a$" } }),
    ],
    [
      "an array with tighter item bounds",
      array(STRING_USE, { minItems: 2, maxItems: 4 }),
      array(STRING_USE, { minItems: 1, maxItems: 5 }),
    ],
  ])("%s", (_name, rendered, accepted) => {
    expect(misfitOf(rendered, accepted, { rendered: false, accepted: false })).toBeUndefined();
  });

  test("a nullable datum into a nullable param", () => {
    expect(misfitOf(STRING_USE, STRING_USE, { rendered: true, accepted: true })).toBeUndefined();
  });
});

describe("a datum that may not fit its param", () => {
  test.each([
    [
      "an enum not narrowed into a narrowed one",
      enumUse("Role"),
      enumUse("Role", ["a"]),
      "values of the enum 'Role'",
    ],
    [
      "a wider narrowing",
      enumUse("Role", ["a", "b"]),
      enumUse("Role", ["a"]),
      "values of the enum 'Role'",
    ],
    ["another enum", enumUse("Other"), enumUse("Role"), "values of the enum 'Role'"],
    ["a string of another format", scalar({}, "email"), scalar({}, "uuid"), "format 'uuid'"],
    [
      "a string with no format into a formatted one",
      scalar({}),
      scalar({}, "uuid"),
      "format 'uuid'",
    ],
    ["a shorter minimum length", scalar({ minLength: 1 }), scalar({ minLength: 3 }), "minLength"],
    ["no minimum length", scalar({}), scalar({ minLength: 3 }), "minLength"],
    ["a longer maximum length", scalar({ maxLength: 20 }), scalar({ maxLength: 9 }), "maxLength"],
    ["no maximum length", scalar({}), scalar({ maxLength: 9 }), "maxLength"],
    [
      "another pattern",
      scalar({ pattern: { source: "^b$", normalized: "^b$" } }),
      scalar({ pattern: { source: "^a$", normalized: "^a$" } }),
      "pattern",
    ],
    [
      "fewer minimum items",
      array(STRING_USE, { minItems: 0 }),
      array(STRING_USE, { minItems: 1 }),
      "minItems",
    ],
    ["no maximum items", array(STRING_USE), array(STRING_USE, { maxItems: 3 }), "maxItems"],
    ["items of another type", array(COUNT_USE), array(STRING_USE), "for an item"],
  ])("%s", (_name, rendered, accepted, reasonPart) => {
    expect(misfitOf(rendered, accepted)).toMatchObject({
      kind: "misfit",
      text: expect.stringContaining(reasonPart),
    });
  });

  test("a nullable datum into a param that does not take null", () => {
    expect(misfitOf(STRING_USE, STRING_USE, { rendered: true })).toMatchObject({ kind: "misfit" });
  });

  test("a datum of one object schema into another whose member has another type", () => {
    expect(misfitOf(ref("Counted"), ref("Wanted"))).toMatchObject({ kind: "misfit" });
  });

  test("a datum of a schema the draft does not hold is a compiler error, not a fit", () => {
    expect(() => misfitOf(ref("Ghost"), ref("Wanted"))).toThrow("the draft holds no schema Ghost");
  });
});
