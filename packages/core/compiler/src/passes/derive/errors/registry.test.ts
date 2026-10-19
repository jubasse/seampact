import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { derivationRoles } from "../../../derivations/index.js";
import {
  DERIVE_ERRORS_FIXTURES,
  DERIVE_ERRORS_PING_SURFACE,
  deriveErrorsLoadFiles,
  deriveErrorsLoadFixture,
  deriveErrorsLocated,
  deriveErrorsReferenceWorkspace,
  deriveErrorsRunContract,
  deriveErrorsRunReference,
} from "./test-support.js";

const expectedRegistry = (path: string): unknown =>
  JSON.parse(readFileSync(`${DERIVE_ERRORS_FIXTURES}${path}`, "utf8"));

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
${DERIVE_ERRORS_PING_SURFACE}`,
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
${DERIVE_ERRORS_PING_SURFACE}`,
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

describe("redeclared default codes", () => {
  const redeclare = (declaration: string) =>
    deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
natures:
  throttled: { base: unavailable }
errors:
  ${declaration}
${DERIVE_ERRORS_PING_SURFACE}`,
      }),
    );

  test("a redeclared default code without nature keeps the core nature, not the one of its status", () => {
    const run = redeclare("api.idempotency_in_progress: { status: 409, title: Still running. }");

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.errors["api.idempotency_in_progress"]?.nature).toBe("unavailable");
  });

  test("a redeclared default code may name a nature on its core base", () => {
    expect(redeclare("api.rate_limited: { status: 429, nature: throttled }").diagnostics).toEqual(
      [],
    );
  });

  test("conventions.errors.pattern applies to a redeclared default code", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
conventions: { errors: { pattern: '^(shop|api)[.][a-z]+$' } }
errors:
  api.not_found: { status: 404, title: Not here. }
  api.rate_limited: { status: 429, title: Slow down. }
${DERIVE_ERRORS_PING_SURFACE}`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-pattern",
        pointer: "/errors/api.not_found",
        related: ["/conventions/errors/pattern"],
      },
      {
        rule: "seampact/derive/error-pattern",
        pointer: "/errors/api.rate_limited",
        related: ["/conventions/errors/pattern"],
      },
    ]);
  });

  test("a redeclared default code changing its status or its nature is refused at the member", () => {
    const run = redeclare("api.not_found: { status: 410, nature: unavailable }");

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-default",
        pointer: "/errors/api.not_found/status",
        related: [],
      },
      {
        rule: "seampact/derive/error-default",
        pointer: "/errors/api.not_found/nature",
        related: [],
      },
    ]);
  });
});

describe("listed error codes", () => {
  test("a code a right, a rule or a scope lists that nobody declares is refused at the list item", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
schemas:
  OrgId: { type: string }
scopes:
  org: { id: OrgId, errors: [api.not_found, shop.not_member] }
rights:
  orgs.manage: { subject: { scope: org }, errors: [shop.denied] }
rules:
  throttle: { bucket: true, errors: [api.rate_limited, shop.slow_down] }
${DERIVE_ERRORS_PING_SURFACE}`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-unknown",
        pointer: "/rights/orgs.manage/errors/0",
        related: [],
      },
      { rule: "seampact/derive/error-unknown", pointer: "/rules/throttle/errors/1", related: [] },
      { rule: "seampact/derive/error-unknown", pointer: "/scopes/org/errors/1", related: [] },
    ]);
  });

  test("a code an identity lists that nobody declares is refused at the list item", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
schemas:
  Viewer: { type: object, properties: { id: { type: string } } }
schemes:
  bearer: { kind: bearer }
identities:
  viewer: { schemes: { read: [bearer], write: [bearer] }, principal: Viewer, errors: [api.unauthenticated, shop.nope] }
${DERIVE_ERRORS_PING_SURFACE}`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-unknown",
        pointer: "/identities/viewer/errors/1",
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

describe("attachment examples", () => {
  test("an attachment's example is checked against the params of the code it attaches", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
errors:
  shop.counted: { status: 400, params: { count: { type: integer } } }
  shop.plain: { status: 409 }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks attachment examples only. }
    errors:
      shop.counted: { example: { count: 3 } }
    routes:
      ping:
        method: get
        errors:
          shop.counted: { example: { count: three } }
          shop.plain: { example: { reason: none } }
`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-example",
        pointer: "/surfaces/app/routes/ping/errors/shop.counted/example/count",
        related: [],
      },
      {
        rule: "seampact/derive/error-example",
        pointer: "/surfaces/app/routes/ping/errors/shop.plain/example",
        related: [],
      },
    ]);
  });
});

describe("default codes", () => {
  test("a contract with no pack registers every default code, from the core, with its role and core params", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }\n${DERIVE_ERRORS_PING_SURFACE}`,
      }),
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

describe("error params carrying a sensitive value", () => {
  // A code whose params hold a sensitive scalar under a map key, one with a sensitive property, and a plain one.
  const sensitiveParamsRun = (policy?: "noStore" | "refuse") =>
    deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
${policy === undefined ? "" : `conventions: { cache: { sensitiveElsewhere: ${policy} } }`}
schemas:
  Token: { type: string, sensitive: true }
errors:
  shop.keyed: { status: 409, params: { byToken: { type: object, propertyNames: { $ref: Token }, additionalProperties: { type: string } } } }
  shop.leaked: { status: 409, params: { secret: { type: string, sensitive: true } } }
  shop.plain: { status: 409, params: { count: { type: integer } } }
${DERIVE_ERRORS_PING_SURFACE}`,
      }),
    );

  const noStoreOf = (run: ReturnType<typeof deriveErrorsRunContract>) =>
    ["shop.keyed", "shop.leaked", "shop.plain"].map((code) => run.draft.errors[code]?.noStore);

  test("by default, the code is no-store", () => {
    for (const run of [sensitiveParamsRun(), sensitiveParamsRun("noStore")]) {
      expect(run.diagnostics).toEqual([]);
      expect(noStoreOf(run)).toEqual([true, true, undefined]);
    }
  });

  test("under refuse, each code is refused at its params, relating the convention", () => {
    const run = sensitiveParamsRun("refuse");

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual(
      ["shop.keyed", "shop.leaked"].map((code) => ({
        rule: "seampact/derive/cache-sensitive-elsewhere",
        pointer: `/errors/${code}/params`,
        related: ["/conventions/cache/sensitiveElsewhere"],
      })),
    );
    expect(noStoreOf(run)).toEqual([undefined, undefined, undefined]);
  });
});
