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
