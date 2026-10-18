import { describe, expect, test } from "vitest";
import {
  type DeriveErrorsRun,
  deriveErrorsLoadFiles,
  deriveErrorsLocated,
  deriveErrorsRunContract,
} from "./test-support.js";

const PING_SURFACE = `
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks role params only. }
    routes:
      ping: { method: get }
`;

const runInline = (body: string): DeriveErrorsRun =>
  deriveErrorsRunContract(
    deriveErrorsLoadFiles({
      "api.yaml": `api: { name: shop, version: 1 }\n${body}${PING_SURFACE}`,
    }),
  );

const located = (run: DeriveErrorsRun) => run.diagnostics.map(deriveErrorsLocated);

const DERIVED = "/conventions/errors/derived";

describe("role params", () => {
  test("a template writing a slot the role does not supply is refused at the slot", () => {
    const run = runInline(`conventions:
  errors: { derived: { sortKeyForbidden: { code: shop.sort_denied, params: { key: $keys } } } }
errors:
  shop.sort_denied: { status: 403, params: { key: { type: string } } }
`);

    expect(located(run)).toEqual([
      {
        rule: "seampact/derive/role-template",
        pointer: `${DERIVED}/sortKeyForbidden/params/key`,
        related: [],
      },
    ]);
  });

  test("an each inside another each's as is refused, since role data are flat", () => {
    const run = runInline(`conventions:
  errors:
    derived:
      schemaInvalid:
        code: api.schema_invalid
        params: { issues: { $each: $issues, $as: { all: { $each: $issues, $as: $item.rule } } } }
`);

    expect(located(run)).toEqual([
      {
        rule: "seampact/derive/role-template",
        pointer: `${DERIVED}/schemaInvalid/params/issues/$as/all`,
        related: [],
      },
    ]);
    expect(run.diagnostics[0]?.message).toContain("role data are flat");
  });

  test("a required param fed by a datum the role may not supply is refused naming role, param and code", () => {
    const run = runInline(`conventions:
  errors: { derived: { forbidden: { code: shop.denied, params: { pointer: $pointer } } } }
errors:
  shop.denied: { status: 403, params: { pointer: { type: string } } }
`);

    expect(located(run)).toEqual([
      {
        rule: "seampact/derive/role-param-required",
        pointer: `${DERIVED}/forbidden/params/pointer`,
        related: [],
      },
    ]);
    expect(run.diagnostics[0]?.message).toBe(
      "role 'forbidden' may leave the required param 'pointer' of 'shop.denied' without a value",
    );
  });

  test("an optional param takes a datum the role may not supply, and a required one a literal", () => {
    const run = runInline(`conventions:
  errors: { derived: { forbidden: { code: shop.denied, params: { pointer: $pointer, reason: denied } } } }
errors:
  shop.denied: { status: 403, params: { pointer?: { type: string }, reason: { type: string } } }
`);

    expect(run.diagnostics).toEqual([]);
  });

  test("a by-name binding leaving a required param without a datum is refused at the binding", () => {
    const run = runInline(`conventions:
  errors: { derived: { notFound: shop.missing } }
errors:
  shop.missing: { status: 404, params: { resource: { type: string } } }
`);

    expect(located(run)).toEqual([
      {
        rule: "seampact/derive/role-param-required",
        pointer: `${DERIVED}/notFound`,
        related: [],
      },
    ]);
  });

  test("a text template filling an integer param is refused at the param", () => {
    const run = runInline(`conventions:
  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }
  errors:
    derived:
      rateLimited: { code: shop.slow_down, params: { retryAfterMs: 'in \${retryAfterMs}' } }
errors:
  shop.slow_down: { status: 429, params: { retryAfterMs: { type: integer, minimum: 0 } } }
`);

    expect(located(run)).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/rateLimited/params/retryAfterMs`,
        related: [],
      },
    ]);
    expect(run.diagnostics[0]?.message).toBe(
      "role 'rateLimited' fills the param 'retryAfterMs' of 'shop.slow_down' with a text, which its type (integer) does not take",
    );
  });

  test("a slot whose datum type the param does not take, and a literal of another type, are refused", () => {
    const run = runInline(`conventions:
  errors:
    derived:
      payloadTooLarge: { code: shop.too_large, params: { limit: $limitBytes, unit: 1 } }
errors:
  shop.too_large: { status: 413, params: { limit?: { type: string }, unit: { type: string } } }
`);

    expect(located(run).map((diagnostic) => [diagnostic.rule, diagnostic.pointer])).toEqual([
      ["seampact/derive/role-param-type", `${DERIVED}/payloadTooLarge/params/limit`],
      ["seampact/derive/role-param-type", `${DERIVED}/payloadTooLarge/params/unit`],
    ]);
  });

  test("a text holding an array datum has no text form and is refused", () => {
    const run = runInline(`conventions:
  errors:
    derived:
      schemaInvalid: { code: shop.invalid, params: { summary: 'bad \${issues}', issues: $issues } }
errors:
  shop.invalid:
    status: 400
    params: { summary: { type: string }, issues: { type: array, items: { type: string } } }
`);

    expect(located(run).map((diagnostic) => diagnostic.rule)).toEqual([
      "seampact/derive/role-param-type",
    ]);
  });

  test("the rate limit param filled under its own key carries the delay; another key does not", () => {
    const run = (params: string) =>
      runInline(`conventions:
  rateLimit: { header: Retry-After, param: delayMs, unit: s }
  errors: { derived: { rateLimited: { code: shop.slow_down, params: ${params} } } }
errors:
  shop.slow_down:
    status: 429
    params: { delayMs?: { type: integer, minimum: 0 }, wait?: { type: integer, minimum: 0 } }
`);

    expect(run("{ delayMs: $retryAfterMs }").diagnostics).toEqual([]);
    expect(located(run("{ wait: $retryAfterMs }"))).toEqual([
      { rule: "seampact/derive/role-datum", pointer: `${DERIVED}/rateLimited`, related: [] },
    ]);
  });
});
