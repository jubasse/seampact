import { readFileSync } from "node:fs";
import type { IrWriter } from "@seampact/spec/ir";
import { checkIrInvariants } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DraftIR, DraftOperation } from "../../../pipeline/seam.js";
import {
  DERIVE_ERRORS_FIXTURES,
  type DeriveErrorsRun,
  deriveErrorsLoadFiles,
  deriveErrorsLocated,
  deriveErrorsLoadFixture,
  deriveErrorsRunContract,
} from "./test-support.js";

const TRIGGERS_FIXTURE = `${DERIVE_ERRORS_FIXTURES}triggers/api.yaml`;

const triggersRun = (): DeriveErrorsRun =>
  deriveErrorsRunContract(deriveErrorsLoadFixture("triggers"));

function errorOf(draft: DraftIR, operationId: string, code: string): IrWriter.OperationError {
  const operation: DraftOperation | undefined = draft.operations.find(
    (candidate) => candidate.id === operationId,
  );
  const error = operation?.errors?.find((candidate) => candidate.code === code);

  if (error === undefined) throw new Error(`operation ${operationId} has no error ${code}`);

  return error;
}

const originsOf = (draft: DraftIR, operationId: string, code: string): string[] =>
  errorOf(draft, operationId, code).derivedFrom?.from.map((origin) => origin.pointer) ?? [];

describe("derived triggers reached through the triggers contract", () => {
  test("a run reports nothing and every operation answers", () => {
    const { diagnostics, draft } = triggersRun();

    expect(diagnostics).toEqual([]);
    expect(draft.operations.map((operation) => operation.id)).toEqual([
      "listNotes",
      "updateNote",
      "listChanges",
      "drafts",
      "jobs",
      "stripe",
      "github",
    ]);
  });

  test("principal.requires and binding.mismatch answer forbidden from the requirement and the binding", () => {
    expect(originsOf(triggersRun().draft, "drafts", "api.forbidden")).toEqual([
      "/surfaces/app/routes/drafts/bindings/body.workspaceId",
      "/surfaces/app/routes/drafts/principal/requires/0",
    ]);
  });

  test("sortKey.restricted answers sortKeyForbidden from the paging, only on the list with a restricted key", () => {
    const { draft } = triggersRun();

    expect(errorOf(draft, "listNotes", "api.sort_key_forbidden").derivedFrom).toEqual({
      derivation: "sortKey.restricted",
      from: [{ layer: "api", pointer: "/surfaces/app/routes/notes/ops/list/paging" }],
    });
    expect(() => errorOf(draft, "listChanges", "api.sort_key_forbidden")).toThrow();
  });

  test("paging.gone answers 410 from a since style only", () => {
    const { draft } = triggersRun();

    expect(errorOf(draft, "listChanges", "api.cursor_too_old").derivedFrom).toEqual({
      derivation: "paging.gone",
      from: [{ layer: "api", pointer: "/surfaces/app/routes/changes/ops/list/paging" }],
    });
    expect(() => errorOf(draft, "listNotes", "api.cursor_too_old")).toThrow();
  });

  test("identity.deadline answers deadlineExceeded where the identity requires the deadline header", () => {
    const { draft } = triggersRun();

    expect(errorOf(draft, "jobs", "api.deadline_exceeded").derivedFrom).toEqual({
      derivation: "identity.deadline",
      from: [
        { layer: "api", pointer: "/headers/deadline" },
        { layer: "api", pointer: "/identities/robot/headers/deadline" },
      ],
    });
    expect(() => errorOf(draft, "drafts", "api.deadline_exceeded")).toThrow();
  });

  test("signed.identity adds the signed identity to unauthenticated's origins", () => {
    const { draft } = triggersRun();

    expect(originsOf(draft, "stripe", "api.unauthenticated")).toEqual([
      "/identities/stripe",
      "/surfaces/hooks/routes/stripe/identity",
    ]);
    expect(originsOf(draft, "listNotes", "api.unauthenticated")).toEqual([
      "/surfaces/app/identity",
    ]);
  });

  test("union.headerTag adds the tagged union to schemaInvalid's origins", () => {
    expect(originsOf(triggersRun().draft, "github", "api.schema_invalid")).toContain(
      "/schemas/GithubEvent",
    );
    expect(originsOf(triggersRun().draft, "stripe", "api.schema_invalid")).not.toContain(
      "/schemas/GithubEvent",
    );
  });

  test("the concurrency header answers 412 and 428 from the version", () => {
    const { draft } = triggersRun();
    const version = [{ layer: "api", pointer: "/surfaces/app/routes/notes/concurrency" }];

    expect(errorOf(draft, "updateNote", "api.precondition_failed").derivedFrom).toEqual({
      derivation: "concurrency.version",
      from: version,
    });
    expect(errorOf(draft, "updateNote", "api.precondition_required").derivedFrom).toEqual({
      derivation: "concurrency.version",
      from: version,
    });
  });

  test("a required idempotency key answers schemaInvalid, an optional one does not", () => {
    expect(originsOf(triggersRun().draft, "drafts", "api.schema_invalid")).toContain(
      "/conventions/idempotency",
    );

    const optional = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": readFileSync(TRIGGERS_FIXTURE, "utf8").replace(
          "methods: [post] }",
          "methods: [post], required: false }",
        ),
      }),
    ).draft;

    expect(originsOf(optional, "drafts", "api.schema_invalid")).not.toContain(
      "/conventions/idempotency",
    );
  });
});

describe("input.invalid under the unknown-query policy", () => {
  const pingContract = (policy: string): string => `api: { name: edge, version: 1 }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks the query policy only. }
    routes:
      ping: { method: get, unknownQuery: ${policy} }
`;

  const pingErrorCodes = (policy: string): string[] => {
    const { draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": pingContract(policy) }),
    );

    return draft.operations[0]?.errors?.map((error) => error.code) ?? [];
  };

  test("an operation without input that refuses unknown query keys answers schemaInvalid", () => {
    expect(pingErrorCodes("refuse")).toContain("api.schema_invalid");
  });

  test("an operation without input that ignores unknown query keys does not", () => {
    expect(pingErrorCodes('{ ignore: "Probes add a cache buster." }')).not.toContain(
      "api.schema_invalid",
    );
  });
});

describe("api.gateway", () => {
  const gatewayContract = (role: string): string => `api: { name: edge, version: 1${role} }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks the gateway codes only. }
    routes:
      ping: { method: get }
`;

  test("a gateway answers 502, 503 and 504 on every operation", () => {
    const { draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": gatewayContract(", role: gateway") }),
    );
    const gateway = { layer: "api", pointer: "/api" };

    for (const code of [
      "api.upstream_unavailable",
      "api.service_unavailable",
      "api.upstream_timeout",
    ])
      expect(errorOf(draft, "ping", code).derivedFrom).toEqual({
        derivation: "api.gateway",
        from: [gateway],
      });
  });

  test("an api that is no gateway answers none of them", () => {
    const { draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": gatewayContract("") }),
    );

    expect(() => errorOf(draft, "ping", "api.upstream_unavailable")).toThrow();
  });
});

const CORE_RATE_LIMITED = `api: { name: shop, version: 1 }
conventions:
  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }
rules:
  slowDown: { bucket: true }
buckets:
  writes: { key: [address], limit: 60, window: 1m }
requirements:
  writeLimit: { rule: slowDown, bucket: writes }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks the retry header only. }
    routes:
      ping: { method: get, requires: [writeLimit] }
`;

const BOUNDED = "type: integer, minimum: 0, maximum: 9007199254740991";

// A bucket rule whose own 429 code `shop.slow` is declared by `declaration`, a catalogue entry or a route's `errors`.
const slowCodeContract = (declaration: { catalogue?: string; route?: string; schemas?: string }) =>
  `api: { name: shop, version: 1 }
conventions:
  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }
${declaration.catalogue === undefined ? "" : `errors:\n  shop.slow: ${declaration.catalogue}\n`}${declaration.schemas ?? ""}rules:
  slowDown: { bucket: true, errors: [shop.slow] }
buckets:
  writes: { key: [address], limit: 60, window: 1m }
requirements:
  writeLimit: { rule: slowDown, bucket: writes }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks the retry header only. }
    routes:
      ping:
        method: get
        requires: [writeLimit]
${declaration.route === undefined ? "" : `        errors:\n          shop.slow: ${declaration.route}\n`}`;

describe("a retry param that cannot render as a safe integer", () => {
  const SLOW_POINTER = "/errors/shop.slow";
  const PARAM_POINTER = `${SLOW_POINTER}/params/retryAfterMs`;
  const refusals: readonly { name: string; contract: string; pointer: string }[] = [
    {
      name: "absent from the code's params",
      contract: slowCodeContract({ catalogue: "{ status: 429 }" }),
      pointer: SLOW_POINTER,
    },
    {
      name: "optional",
      contract: slowCodeContract({
        catalogue: `{ status: 429, params: { retryAfterMs?: { ${BOUNDED} } } }`,
      }),
      pointer: SLOW_POINTER,
    },
    {
      name: "nullable",
      contract: slowCodeContract({
        catalogue: `{ status: 429, params: { retryAfterMs: { ${BOUNDED}, nullable: true } } }`,
      }),
      pointer: PARAM_POINTER,
    },
    {
      name: "not an integer",
      contract: slowCodeContract({
        catalogue: "{ status: 429, params: { retryAfterMs: { type: string } } }",
      }),
      pointer: PARAM_POINTER,
    },
    {
      name: "an integer with a format",
      contract: slowCodeContract({
        catalogue: `{ status: 429, params: { retryAfterMs: { ${BOUNDED}, format: int64 } } }`,
      }),
      pointer: PARAM_POINTER,
    },
    {
      name: "an integer with no minimum",
      contract: slowCodeContract({
        catalogue:
          "{ status: 429, params: { retryAfterMs: { type: integer, maximum: 9007199254740991 } } }",
      }),
      pointer: PARAM_POINTER,
    },
    {
      name: "an integer with a negative minimum",
      contract: slowCodeContract({
        catalogue: `{ status: 429, params: { retryAfterMs: { type: integer, minimum: -1, maximum: 9007199254740991 } } }`,
      }),
      pointer: PARAM_POINTER,
    },
    {
      name: "declared by a named params schema (located at the declaration)",
      contract: slowCodeContract({
        catalogue: "{ status: 429, params: SlowParams }",
        schemas: `schemas:\n  SlowParams: { type: object, required: [retryAfterMs], properties: { retryAfterMs: { type: integer, minimum: 0 } } }\n`,
      }),
      pointer: SLOW_POINTER,
    },
    {
      name: "declared on a tree node (located at the declaration)",
      contract: slowCodeContract({
        route: "{ status: 429, params: { retryAfterMs: { type: integer, minimum: 0 } } }",
      }),
      pointer: "/surfaces/app/routes/ping/errors/shop.slow",
    },
  ];

  test.each(refusals)(
    "$name is refused once, located at $pointer, and writes no header",
    (refusal) => {
      const run = deriveErrorsRunContract(deriveErrorsLoadFiles({ "api.yaml": refusal.contract }));

      expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
        {
          rule: "seampact/derive/retry-param",
          pointer: refusal.pointer,
          related: ["/conventions/rateLimit/param"],
        },
      ]);
      expect(errorOf(run.draft, "ping", "shop.slow").retryHeader).toBeUndefined();
    },
  );

  test("a bucket rule whose codes hold no 429 is allowed and carries no retry header", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": slowCodeContract({ catalogue: "{ status: 503 }" }),
      }),
    );

    expect(run.diagnostics).toEqual([]);
    expect(errorOf(run.draft, "ping", "shop.slow").retryHeader).toBeUndefined();
  });
});

describe("the retry header", () => {
  const retryViolations = (draft: DraftIR) =>
    checkIrInvariants({
      errors: draft.errors,
      schemas: draft.schemas,
      operations: draft.operations,
    }).filter(({ id }) => id === "ir.error.retry-header");

  test("a bucket rule without codes passes ir.error.retry-header on a declared bounded param", () => {
    const { draft } = deriveErrorsRunContract(deriveErrorsLoadFixture("operations"));

    expect(errorOf(draft, "updateTask", "api.rate_limited").retryHeader).toMatchObject({
      name: "Retry-After",
      param: "retryAfterMs",
    });
    expect(retryViolations(draft)).toEqual([]);
  });

  test("a core api.rate_limited with conventions.rateLimit and a codeless bucket rule passes ir.error.retry-header", () => {
    const { draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": CORE_RATE_LIMITED }),
    );
    const params = draft.schemas.ApiRateLimitedParams;

    expect(errorOf(draft, "ping", "api.rate_limited").retryHeader).toMatchObject({
      param: "retryAfterMs",
    });
    expect(params?.kind === "object" ? params.properties[0]?.optional : undefined).toBe(false);
    expect(retryViolations(draft)).toEqual([]);
  });

  test("the core retryAfterMs datum is bounded by the largest safe integer", () => {
    const { draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": CORE_RATE_LIMITED }),
    );
    const property =
      draft.schemas.ApiRateLimitedParams?.kind === "object"
        ? draft.schemas.ApiRateLimitedParams.properties[0]
        : undefined;

    expect(property?.type).toMatchObject({
      refinements: { minimum: "0", maximum: "9007199254740991" },
    });
  });
  test("a redeclared api.rate_limited whose param is unbounded is refused at the param and writes no header", () => {
    const unbounded = CORE_RATE_LIMITED.replace(
      "surfaces:",
      `errors:
  api.rate_limited:
    status: 429
    params: { retryAfterMs: { type: integer, minimum: 0 } }
surfaces:`,
    );
    const run = deriveErrorsRunContract(deriveErrorsLoadFiles({ "api.yaml": unbounded }));

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/retry-param",
        pointer: "/errors/api.rate_limited/params/retryAfterMs",
        related: ["/conventions/rateLimit/param"],
      },
    ]);
    expect(errorOf(run.draft, "ping", "api.rate_limited").retryHeader).toBeUndefined();
    expect(retryViolations(run.draft)).toEqual([]);
  });
});

describe("identity.versionToken", () => {
  const versionTokenContract = (stale: string): string => `api: { name: shop, version: 1 }
errors:
  shop.rights_stale: { status: 409 }
schemas:
  Viewer: { type: object, properties: { id: { type: string }, rightsVersion: { type: string } } }
schemes:
  bearer: { kind: bearer }
headers:
  rightsVersion: { semantic: versionToken, response: X-Rights-Version, request: If-Rights-Version }
identities:
  viewer:
    schemes: { read: [bearer], write: [bearer] }
    principal: Viewer
    headers:
      rightsVersion: { from: principal.rightsVersion, for: writes, stale: ${stale} }
surfaces:
  app:
    prefix: /v{version}
    identity: viewer
    routes:
      ping: { method: get }
      poke: { method: post }
`;

  test("a write answers the use's stale code from the request header, a read does not", () => {
    const { diagnostics, draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": versionTokenContract("shop.rights_stale") }),
    );

    expect(diagnostics).toEqual([]);
    expect(errorOf(draft, "poke", "shop.rights_stale").derivedFrom).toEqual({
      derivation: "identity.versionToken",
      from: [
        { layer: "api", pointer: "/headers/rightsVersion" },
        { layer: "api", pointer: "/identities/viewer/headers/rightsVersion" },
      ],
    });
    expect(() => errorOf(draft, "ping", "shop.rights_stale")).toThrow();
  });

  test("a stale code nobody declares is refused at the use", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": versionTokenContract("shop.nope") }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-unknown",
        pointer: "/identities/viewer/headers/rightsVersion/stale",
        related: [],
      },
    ]);
  });
});
