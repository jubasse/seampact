import { describe, expect, test } from "vitest";
import { type TreeSchemasRun, treeSchemasRunFixture } from "./test-support.js";

const located = (run: TreeSchemasRun) =>
  run.diagnostics.map((d) => [d.rule.replace("seampact/tree/", ""), d.origin.pointer]);

describe("tree.schemas on the lane fixtures", () => {
  test("catalogues: unions, formats, derived objects, enums, unknown keys, defaults and extensions", () => {
    const run = treeSchemasRunFixture("catalogues", "shop");
    const orders = "/surfaces/app/routes/orders/ops";

    expect(located(run)).toEqual([]);
    expect(Object.keys(run.draft.schemas)).toEqual(
      expect.arrayContaining(["Order", "OpenOrder", "Payment", "PaymentCard", "CreateOrder"]),
    );
    expect(run.draft.schemas.Payment?.directions).toEqual(["input"]);
    expect(run.draft.enums.OrderState?.directions).toEqual(["output"]);
    expect(run.draft.scalars.sku?.directions).toEqual(["input", "output"]);
    expect(run.service.typeUse(`${orders}/create/input`, "input")).toEqual({
      kind: "ref",
      schema: "CreateOrder",
      unknownKeys: {
        policy: "refuse",
        origin: { layer: "api", pointer: `${orders}/create/input/unknownKeys` },
      },
    });
    expect(run.draft.extensionKeys["acme-tax-basis"]?.places).toEqual(["operation", "property"]);
    expect(run.service.queryWire(`${orders}/list/query/limit?`)?.kind).toBe("number");
  });

  test("refused: maps without a wire, values off their schema, misplaced defaults and extensions", () => {
    const run = treeSchemasRunFixture("refused", "forms");

    expect(located(run)).toEqual([
      ["mark-position", "/surfaces/app/routes/search/query/term/default"],
      ["extension-unknown", "/surfaces/app/routes/search/x-acme-nope"],
      ["extension-place", "/schemas/Upload/properties/kind/x-acme-owner"],
      ["example-value", "/schemas/Upload/properties/name/examples/0"],
      ["default-value", "/schemas/Upload/properties/size/default"],
      ["extension-value", "/schemas/Upload/x-acme-owner"],
      ["query-map", "/rules/fresh/proof/schema"],
      ["query-map", "/rules/signed/proof/schema"],
      ["query-map", "/surfaces/app/routes/search/query/labels?"],
    ]);
    expect(run.located).toBe(true);
  });
});
