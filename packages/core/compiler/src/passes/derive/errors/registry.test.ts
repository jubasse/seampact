import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { derivationRoles } from "../../../derivations/index.js";
import {
  DERIVE_ERRORS_FIXTURES,
  deriveErrorsLoadFiles,
  deriveErrorsLoadFixture,
  deriveErrorsLocated,
  deriveErrorsReferenceWorkspace,
  deriveErrorsRunContract,
  deriveErrorsRunReference,
} from "./test-support.js";

const expectedRegistry = (path: string): unknown =>
  JSON.parse(readFileSync(`${DERIVE_ERRORS_FIXTURES}${path}`, "utf8"));

const PING_SURFACE = `
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks error declarations only. }
    routes:
      ping: { method: get }
`;

const registryOf = (run: ReturnType<typeof deriveErrorsRunContract>): unknown => ({
  errors: { ...run.draft.errors },
  natures: { ...run.draft.natures },
});

describe("error registry", () => {
  test("catalogue, base and pack declarations with default natures, families and checked examples", () => {
    const run = deriveErrorsRunContract(deriveErrorsLoadFixture("registry"));

    expect(run.diagnostics).toEqual([]);
    expect(registryOf(run)).toEqual(expectedRegistry("registry/registry.json"));
  });

  test("the reference contract's registry, from its after-access draft", () => {
    const workspace = deriveErrorsReferenceWorkspace();

    for (const api of ["tasks", "tasksService"] as const) {
      const run = deriveErrorsRunReference(workspace, api);

      expect(run.diagnostics).toEqual([]);
      expect(registryOf(run)).toEqual(expectedRegistry("reference/registry.json"));
    }
  });

  test("codes outside the dotted form compile, and conventions.errors.pattern refuses them on request", () => {
    const accepted = deriveErrorsRunContract(deriveErrorsLoadFixture("registry"));

    expect(Object.keys(accepted.draft.errors)).toEqual(
      expect.arrayContaining(["TASK_NOT_FOUND", "E1042", "404-gone"]),
    );
    expect(accepted.draft.errors["E1042"]?.family).toBeUndefined();

    const refused = deriveErrorsRunContract(deriveErrorsLoadFixture("registry-refused"));

    expect(refused.diagnostics.map(deriveErrorsLocated)).toEqual([
      { rule: "seampact/derive/nature-base", pointer: "/natures/refused", related: [] },
      ...["TASK_NOT_FOUND", "E1042", "404-gone"].map((code) => ({
        rule: "seampact/derive/error-pattern",
        pointer: `/errors/${code}`,
        related: ["/conventions/errors/pattern"],
      })),
      { rule: "seampact/derive/error-nature", pointer: "/errors/shop.odd/nature", related: [] },
      { rule: "seampact/derive/error-example", pointer: "/errors/shop.bare/example", related: [] },
      {
        rule: "seampact/derive/error-example",
        pointer: "/errors/shop.counted/example/count",
        related: [],
      },
      {
        rule: "seampact/derive/error-redefined",
        pointer: "/surfaces/app/errors/shop.locked",
        related: ["/errors/shop.locked"],
      },
      {
        rule: "seampact/derive/error-unknown",
        pointer: "/surfaces/app/errors/shop.missing",
        related: [],
      },
      {
        rule: "seampact/derive/error-unknown",
        pointer: "/conventions/errors/every/0",
        related: [],
      },
    ]);
  });

  test("a pattern that is no regular expression is refused at the convention", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
conventions: { errors: { pattern: '[' } }
errors:
  shop.failed: { status: 500 }
${PING_SURFACE}`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-pattern",
        pointer: "/conventions/errors/pattern",
        related: [],
      },
    ]);
  });

  test("an example missing a required param is located at the example", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
errors:
  shop.counted: { status: 400, params: { count: { type: integer } }, example: {} }
${PING_SURFACE}`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-example",
        pointer: "/errors/shop.counted/example",
        related: [],
      },
    ]);
  });
});

describe("node error declarations", () => {
  test("a code declared on a surface, a collection, a scope or a route joins the registry with that node's origin", () => {
    const { draft } = deriveErrorsRunContract(deriveErrorsLoadFixture("registry"));

    expect(
      ["shop.maintenance", "members.locked", "members.full", "ping.slow"].map(
        (code) => draft.errors[code]?.origin.pointer,
      ),
    ).toEqual([
      "/surfaces/app/errors/shop.maintenance",
      "/surfaces/app/routes/members/errors/members.locked",
      "/surfaces/app/routes/members/collection/errors/members.full",
      "/surfaces/app/routes/ping/errors/ping.slow",
    ]);
  });

  test("a declaration repeated with the same definition and another reach is no redefinition", () => {
    const run = deriveErrorsRunContract(deriveErrorsLoadFixture("registry"));

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.errors["shop.maintenance"]?.origin.pointer).toBe(
      "/surfaces/app/errors/shop.maintenance",
    );
  });

  test("a node declaration that differs from another node's is refused naming both", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks error declarations only. }
    errors:
      shop.busy: { status: 503 }
    routes:
      ping: { method: get, errors: { shop.busy: { status: 503, title: Busy. } } }
`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-redefined",
        pointer: "/surfaces/app/routes/ping/errors/shop.busy",
        related: ["/surfaces/app/errors/shop.busy"],
      },
    ]);
  });
});

describe("default codes", () => {
  test("a contract with no pack registers every default code, from the core, with its role and core params", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": `api: { name: shop, version: 1 }\n${PING_SURFACE}` }),
    );

    expect(run.diagnostics).toEqual([]);
    expect(Object.keys(run.draft.errors)).toHaveLength(derivationRoles.length);

    for (const role of derivationRoles) {
      const declaration = run.draft.errors[role.defaultCode];

      expect(declaration).toMatchObject({
        code: role.defaultCode,
        nature: role.nature,
        http: { status: role.status },
        origin: { layer: "core", pointer: `/errors/${role.defaultCode}` },
        default: role.role,
      });
      expect(declaration?.params !== undefined).toBe(role.data.length > 0);
      expect(
        declaration?.params === undefined || run.draft.schemas[declaration.params] !== undefined,
      ).toBe(true);
    }
  });

  test("a layer declaring a default code replaces it, with its own params or the core ones", () => {
    const { draft } = deriveErrorsRunContract(deriveErrorsLoadFixture("registry"));
    const rateLimited = draft.schemas["ApiRateLimitedParams"];

    expect(draft.errors["api.rate_limited"]?.origin).toEqual({
      layer: "api",
      pointer: "/errors/api.rate_limited",
    });
    expect(rateLimited?.origin.layer).toBe("api");
    expect(draft.errors["api.payload_too_large"]).toMatchObject({
      params: "ApiPayloadTooLargeParams",
      title: "The body is too large.",
      origin: { layer: "api" },
      default: "payloadTooLarge",
    });
    expect(draft.schemas["ApiPayloadTooLargeParams"]?.origin.layer).toBe("core");
  });
});
