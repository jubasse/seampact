import { describe, expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { DeriveErrorsRule } from "./report.js";
import { deriveErrorsLoadFixture, deriveErrorsRunContract } from "./test-support.js";

// Every rule of derive.errors, from the refused fixtures, each at its layer and pointer; each diagnostic resolves
// through the api's side table, its related locations too, and states one sentence and a fix.
const REFUSED: Record<string, [DeriveErrorsRule, string, string][]> = {
  "registry-refused": [
    ["nature-base", "api", "/natures/refused"],
    ["error-pattern", "api", "/errors/TASK_NOT_FOUND"],
    ["error-pattern", "api", "/errors/E1042"],
    ["error-pattern", "api", "/errors/404-gone"],
    ["error-nature", "api", "/errors/shop.odd/nature"],
    ["error-example", "api", "/errors/shop.bare/example"],
    ["error-example", "api", "/errors/shop.counted/example/count"],
    ["error-redefined", "api", "/surfaces/app/errors/shop.locked"],
    ["error-unknown", "api", "/surfaces/app/errors/shop.missing"],
    ["error-unknown", "api", "/conventions/errors/every/0"],
  ],
  "bindings-refused": [
    ["role-datum", "api", "/conventions/errors/derived/sortKeyForbidden"],
    ["role-code", "api", "/conventions/errors/derived/notFound"],
    ["role-datum", "api", "/errors/api.rate_limited"],
    ["role-code", "api", "/surfaces/app/errorRoles/forbidden"],
  ],
};

describe("derive.errors and link diagnostics are located", () => {
  for (const [fixture, expected] of Object.entries(REFUSED))
    test(`${fixture}: each rule at its layer and pointer, resolving in the side table`, () => {
      const workspace = deriveErrorsLoadFixture(fixture);
      const { diagnostics } = deriveErrorsRunContract(workspace);
      const locations = workspace.apis[0]?.locations ?? {};

      expect(
        diagnostics.map((diagnostic) => [
          diagnostic.rule.replace("seampact/derive/", ""),
          diagnostic.origin.layer,
          diagnostic.origin.pointer,
        ]),
      ).toEqual(expected);

      for (const diagnostic of diagnostics) {
        expect(diagnostic.rule).toMatch(/^seampact\/derive\/[a-z]+(-[a-z]+)*$/);
        expect(diagnostic.severity).toBe("error");
        expect(diagnostic.message).not.toMatch(/\.\s/);
        expect(diagnostic.fix.length).toBeGreaterThan(0);

        for (const origin of [diagnostic.origin, ...diagnostic.related.map((item) => item.origin)])
          expect(Object.hasOwn(locations, diagnosticLocationKey(origin))).toBe(true);
      }
    });

  test("a redefinition relates the first declaration", () => {
    const { diagnostics } = deriveErrorsRunContract(deriveErrorsLoadFixture("registry-refused"));
    const redefined = diagnostics.find((item) => item.rule === "seampact/derive/error-redefined");

    expect(redefined?.related.map((item) => item.origin)).toEqual([
      { layer: "api", pointer: "/errors/shop.locked" },
    ]);
  });
});
