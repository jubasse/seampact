import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  ACCESS_RIGHTS_FIXTURES,
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

const expectedCatalogues = (fixture: string): unknown =>
  JSON.parse(readFileSync(`${ACCESS_RIGHTS_FIXTURES}${fixture}/catalogues.json`, "utf8"));

const PING_ROUTES = `
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks catalogues only. }
    routes:
      ping: { method: get }
`;

describe("rights catalogue", () => {
  test("rights, rules, scopes and buckets as declared, with docs, codeName and extension values", () => {
    const { draft, diagnostics } = accessRightsRunContract(accessRightsLoadFixture("catalogues"));

    expect(diagnostics).toEqual([]);
    expect({
      rights: { ...draft.rights },
      rules: { ...draft.rules },
      scopes: { ...draft.scopes },
      buckets: { ...draft.buckets },
    }).toEqual(expectedCatalogues("catalogues"));
  });

  // The loader refuses `__proto__`, `constructor` and `prototype` keys; other inherited names stay ordinary rights.
  test("a right without written errors answers the code the api binds to the forbidden role", () => {
    const { draft, diagnostics } = accessRightsRunContract(
      accessRightsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
conventions:
  errors: { derived: { forbidden: { code: shop.denied } } }
rights:
  shop.open: {}
  shop.close: { errors: [] }
${PING_ROUTES}`,
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(draft.rights["shop.open"]?.errors).toEqual(["shop.denied"]);
    expect(draft.rights["shop.close"]?.errors).toEqual([]);
  });

  test("rights named like inherited members are entries, read as own members only", () => {
    const { draft, diagnostics } = accessRightsRunContract(
      accessRightsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
rights:
  toString: { summary: Odd but valid. }
  hasOwnProperty: {}
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks catalogues only. }
    requires: [{ right: valueOf }, { right: toString }]
    routes:
      ping: { method: get }
`,
      }),
    );

    expect(diagnostics.map(({ rule, message }) => [rule, message])).toEqual([
      [
        "seampact/access/requirement-target",
        "the requirement names right 'valueOf', which the rights catalogue does not declare",
      ],
      [
        "seampact/access/guest-right",
        "right 'toString' is required on public route 'ping', where an anonymous caller reaches it, and the right has no 'guest' reason",
      ],
    ]);
    expect(Object.keys(draft.rights)).toEqual(["toString", "hasOwnProperty"]);
    expect(Object.getPrototypeOf(draft.rights)).toBeNull();
    // Typed `string`, so the read goes through the catalogue's index and not Object's `toString`.
    const inheritedName: string = "toString";

    expect(draft.rights[inheritedName]?.docs).toEqual({ summary: "Odd but valid." });
  });

  test("names outside the pattern or without a segment, undeclared scopes, a cycle, a proof, a bucket", () => {
    const { draft, diagnostics } = accessRightsRunContract(
      accessRightsLoadFixture("catalogues-refused"),
    );

    expect(diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
      ["seampact/access/right-pattern", "/rights/Tasks"],
      ["seampact/access/right-name", "/rights/tasks.code"],
      ["seampact/access/right-pattern", "/rights/*"],
      ["seampact/access/right-name", "/rights/*"],
      ["seampact/access/right-subject", "/rights/tasks.own/subject/scope"],
      ["seampact/access/proof-schema", "/rules/stepUp/proof"],
      ["seampact/access/scope-within", "/scopes/team/within"],
      ["seampact/access/scope-within", "/scopes/left/within"],
      ["seampact/access/bucket-key", "/buckets/wide/key/0"],
      ["seampact/access/bucket-window", "/buckets/forever/window"],
    ]);
    expect(diagnostics[0]?.related).toEqual([
      {
        origin: { layer: "api", pointer: "/conventions/rights/pattern" },
        message: "the pattern is set here",
      },
    ]);
    expect(diagnostics[7]?.message).toBe(
      "scope 'left' is within itself through left -> right -> left",
    );
    expect(Object.keys(draft.rights)).toEqual(["tasks.read"]);
    expect(Object.keys(draft.scopes)).toEqual([]);
  });

  test("a rights pattern that is no regular expression is an error, and narrows nothing", () => {
    const { draft, diagnostics } = accessRightsRunContract(
      accessRightsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }\nconventions:\n  rights: { pattern: '(' }\nrights:\n  Anything: {}\n${PING_ROUTES}`,
      }),
    );

    expect(diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
      ["seampact/access/right-pattern", "/conventions/rights/pattern"],
    ]);
    expect(Object.keys(draft.rights)).toEqual(["Anything"]);
  });
});
