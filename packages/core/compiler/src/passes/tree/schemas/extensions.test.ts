import { describe, expect, test } from "vitest";
import { type TreeSchemasRun, treeSchemasRunApi } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);

const DECLARED = `enums:
  TaxBasis: { values: [inclusive, exclusive], reason: "Tax rules." }
extensions:
  acme:
    tax-basis: { at: [operation, property], schema: { enum: TaxBasis } }
    owner: { at: [schema, right], schema: { type: string, minLength: 2 } }
`;

describe("extension values validated", () => {
  test("declared keys are written with their schema and places, values on schemas and properties", () => {
    const run = treeSchemasRunApi(`${DECLARED}schemas:
  Price:
    type: object
    x-acme-owner: billing
    properties: { amount: { type: integer, x-acme-tax-basis: inclusive } }
surfaces:
  app:
    x-acme-tax-basis: exclusive
    routes:
      prices: { method: get, output: Price }
`);
    const price = run.draft.schemas.Price;

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.extensionKeys["acme-tax-basis"]).toEqual({
      id: "acme-tax-basis",
      prefix: "acme",
      key: "tax-basis",
      schema: { kind: "enum", enum: "TaxBasis" },
      places: ["operation", "property"],
      origin: { layer: "api", pointer: "/extensions/acme/tax-basis" },
    });
    expect(price?.extensions).toEqual({ acme: { owner: "billing" } });
    expect(price?.kind === "object" ? price.properties[0]?.extensions : undefined).toEqual({
      acme: { "tax-basis": "inclusive" },
    });
  });

  test("an undeclared key, a key off its places and a value off its schema are refused, located", () => {
    const run = treeSchemasRunApi(`${DECLARED}
schemas:
  Price:
    type: object
    x-acme-owner: b
    properties:
      net: { type: integer, x-acme-tax-basis: gross }
      code: { type: string, x-acme-owner: shop }
  Money: { type: integer, x-acme-owner: cash }
surfaces:
  app:
    routes:
      prices: { method: get, output: Price, x-acme-nope: 1 }
`);

    expect(located(run)).toEqual([
      ["extension-unknown", "/surfaces/app/routes/prices/x-acme-nope"],
      ["extension-place", "/schemas/Price/properties/code/x-acme-owner"],
      ["extension-place", "/schemas/Money/x-acme-owner"],
      ["extension-value", "/schemas/Price/x-acme-owner"],
      ["extension-value", "/schemas/Price/properties/net/x-acme-tax-basis"],
    ]);
    expect(run.diagnostics.map((d) => d.message)).toEqual([
      "'x-acme-nope' is no declared extension key",
      "'x-acme-owner' may sit on schema, right, not on property",
      "'x-acme-owner' may sit on schema, right, not on a schema that writes no named schema",
      "the extension does not fit its schema at '': 'b' is shorter than 2 characters",
      "the extension does not fit its schema at '': 'gross' is not a value of TaxBasis",
    ]);
    expect(run.diagnostics[1]?.related.map((r) => r.origin.pointer)).toEqual([
      "/extensions/acme/owner",
    ]);
    expect(run.located).toBe(true);
  });
});
