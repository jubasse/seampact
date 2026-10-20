import { describe, expect, test } from "vitest";
import {
  DERIVE_ERRORS_PING_SURFACE,
  type DeriveErrorsRun,
  deriveErrorsLoadFiles,
  deriveErrorsLocated,
  deriveErrorsRunContract,
} from "./test-support.js";

const runInline = (body: string): DeriveErrorsRun =>
  deriveErrorsRunContract(
    deriveErrorsLoadFiles({
      "api.yaml": `api: { name: shop, version: 1 }\n${body}${DERIVE_ERRORS_PING_SURFACE}`,
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
      "role 'rateLimited' fills the param 'retryAfterMs' of 'shop.slow_down' with a text, but the param's type (integer) does not take string",
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
schemas:
  Issue: { type: object, properties: { in: { type: string }, pointer: { type: string }, rule: { type: string } } }
errors:
  shop.invalid: { status: 400, params: { summary: { type: string }, issues: { type: array, items: Issue } } }
`);

    expect(located(run).map((diagnostic) => diagnostic.rule)).toEqual([
      "seampact/derive/role-param-type",
    ]);
  });

  test("an issue item merged whole fills the param's item; each merged member is checked as a written one", () => {
    const run = (as: string, item: string) =>
      runInline(`conventions:
  errors:
    derived:
      schemaInvalid: { code: shop.invalid, params: { issues: { $each: $issues, $as: ${as} } } }
schemas:
  Issue: { type: object, required: [pointer, rule], properties: ${item} }
errors:
  shop.invalid: { status: 400, params: { issues: { type: array, items: Issue } } }
`);
    const whole = "{ in: { type: string }, pointer: { type: string }, rule: { type: string } }";
    const mergedAt = `${DERIVED}/schemaInvalid/params/issues/$as/$merge`;

    expect(run("{ $merge: $item }", whole).diagnostics).toEqual([]);
    expect(
      located(run("{ $merge: $item }", "{ pointer: { type: string }, rule: { type: string } }")),
    ).toEqual([{ rule: "seampact/derive/role-param-type", pointer: mergedAt, related: [] }]);
    expect(
      located(
        run(
          "{ $merge: $item }",
          "{ in: { type: integer }, pointer: { type: string }, rule: { type: string } }",
        ),
      ),
    ).toEqual([{ rule: "seampact/derive/role-param-type", pointer: mergedAt, related: [] }]);
    expect(located(run("{ pointer: $item.pointer, rule: $item.rule, extra: x }", whole))).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/schemaInvalid/params/issues/$as/extra`,
        related: [],
      },
    ]);
  });

  test("the issues slot fills an item schema of the same members, and is refused into one lacking a member", () => {
    const run = (item: string) =>
      runInline(`conventions:
  errors: { derived: { schemaInvalid: { code: shop.invalid, params: { issues: $issues } } } }
schemas:
  Issue: { type: object, properties: ${item} }
errors:
  shop.invalid: { status: 400, params: { issues: { type: array, items: Issue } } }
`);

    expect(
      run("{ in: { type: string }, pointer: { type: string }, rule: { type: string } }")
        .diagnostics,
    ).toEqual([]);
    expect(located(run("{ pointer: { type: string }, rule: { type: string } }"))).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/schemaInvalid/params/issues`,
        related: [],
      },
    ]);
  });

  test("a slot path naming no member of its datum is refused at the slot", () => {
    const keyed = (detail: string) =>
      runInline(`conventions:
  errors: { derived: { sortKeyForbidden: { code: shop.sort_denied, params: { detail: ${detail} } } } }
errors:
  shop.sort_denied: { status: 403, params: { detail?: { type: string } } }
`);
    const issued = (pointer: string) =>
      runInline(`conventions:
  errors:
    derived:
      schemaInvalid: { code: shop.invalid, params: { issues: { $each: $issues, $as: { pointer: ${pointer} } } } }
schemas:
  Issue: { type: object, properties: { pointer: { type: string } } }
errors:
  shop.invalid: { status: 400, params: { issues: { type: array, items: Issue } } }
`);

    expect(keyed("$key").diagnostics).toEqual([]);
    expect(located(keyed("$key.nothing"))).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/sortKeyForbidden/params/detail`,
        related: [],
      },
    ]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the authored text holds a literal placeholder
    expect(located(keyed("'by ${key.nothing}'"))).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/sortKeyForbidden/params/detail`,
        related: [],
      },
    ]);
    expect(issued("$item.pointer").diagnostics).toEqual([]);
    expect(located(issued("$item.pointr"))).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/schemaInvalid/params/issues/$as/pointer`,
        related: [],
      },
    ]);
  });

  test("a literal is validated against its param's type: an enum value outside the enum is refused", () => {
    const run = (reason: string) =>
      runInline(`conventions:
  errors: { derived: { sortKeyForbidden: { code: shop.sort_denied, params: { key: $key, reason: ${reason} } } } }
enums:
  Reason: { values: [a, b] }
errors:
  shop.sort_denied:
    status: 403
    params: { key: { type: string }, reason: { enum: Reason }, note?: { type: string, nullable: true } }
`);

    expect(run("a").diagnostics).toEqual([]);
    expect(located(run("c"))).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/sortKeyForbidden/params/reason`,
        related: [],
      },
    ]);
  });

  test("a datum fills an enum, format, refinement or union param only when its own type provably keeps within it", () => {
    const run = (param: string, datum = "$key") =>
      runInline(`conventions:
  rateLimit: { header: Retry-After, param: wait, unit: s }
  errors:
    derived:
      sortKeyForbidden: { code: shop.sort_denied, params: { key: ${datum} } }
      rateLimited: { code: shop.slow_down, params: { wait: $retryAfterMs } }
enums:
  Reason: { values: [a, b] }
schemas:
  Notice:
    discriminator: kind
    oneOf: { done: { type: object, properties: { at: { type: string } } } }
errors:
  shop.sort_denied: { status: 403, params: { key: ${param} } }
  shop.slow_down: { status: 429, params: { wait: { type: number, minimum: -1 } } }
`);
    const refusedAt = [
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/sortKeyForbidden/params/key`,
        related: [],
      },
    ];

    expect(run("{ type: string }").diagnostics).toEqual([]);

    for (const param of [
      "{ enum: Reason }",
      "{ type: string, format: uuid }",
      "{ type: string, maxLength: 2 }",
      "Notice",
    ])
      expect(located(run(param)), param).toEqual(refusedAt);

    expect(located(run("{ type: string }", "{ at: $key }"))).toEqual(refusedAt);
  });

  test("a union param takes only an object: an array literal, an array template and an each are refused", () => {
    const run = (template: string) =>
      runInline(`conventions:
  errors: { derived: { schemaInvalid: { code: shop.invalid, params: { issues: $issues, notice: ${template} } } } }
schemas:
  Issue: { type: object, properties: { in: { type: string }, pointer: { type: string }, rule: { type: string } } }
  Notice:
    discriminator: kind
    oneOf: { done: { type: object, properties: { at: { type: string } } } }
errors:
  shop.invalid: { status: 400, params: { issues: { type: array, items: Issue }, notice: Notice } }
`);

    for (const template of ["[a]", "[$issues]", "{ $each: $issues, $as: $item.rule }"])
      expect(located(run(template)), template).toEqual([
        {
          rule: "seampact/derive/role-param-type",
          pointer: `${DERIVED}/schemaInvalid/params/notice`,
          related: [],
        },
      ]);
  });

  test("the delay fills a param whose bounds it keeps within, and is refused by a narrower one", () => {
    const run = (wait: string) =>
      runInline(`conventions:
  rateLimit: { header: Retry-After, param: wait, unit: s }
  errors: { derived: { rateLimited: { code: shop.slow_down, params: { wait: $retryAfterMs } } } }
errors:
  shop.slow_down: { status: 429, params: { wait: ${wait} } }
`);

    expect(run("{ type: number, minimum: -1 }").diagnostics).toEqual([]);
    expect(run("{ type: integer, exclusiveMinimum: -1 }").diagnostics).toEqual([]);

    for (const wait of ["{ type: integer, minimum: 1 }", "{ type: integer, maximum: 10 }"])
      expect(located(run(wait)), wait).toEqual([
        {
          rule: "seampact/derive/role-param-type",
          pointer: `${DERIVED}/rateLimited/params/wait`,
          related: [],
        },
      ]);
  });

  test("an array param's item bounds refuse an each over a datum without them, and a literal array too long", () => {
    const run = (params: string, template: string) =>
      runInline(`conventions:
  errors: { derived: { schemaInvalid: { code: shop.invalid, params: ${template} } } }
schemas:
  Issue: { type: object, properties: { in: { type: string }, pointer: { type: string }, rule: { type: string } } }
errors:
  shop.invalid: { status: 400, params: ${params} }
`);

    expect(
      run(
        "{ issues: { type: array, items: Issue }, tags: { type: array, items: { type: string }, maxItems: 1 } }",
        "{ issues: $issues, tags: [a] }",
      ).diagnostics,
    ).toEqual([]);
    expect(
      located(
        run(
          "{ issues: { type: array, items: Issue, minItems: 1 } }",
          "{ issues: { $each: $issues, $as: $item } }",
        ),
      ),
    ).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/schemaInvalid/params/issues`,
        related: [],
      },
    ]);
    expect(
      located(
        run(
          "{ issues: { type: array, items: Issue }, tags: { type: array, items: { type: string }, maxItems: 1 } }",
          "{ issues: $issues, tags: [a, b] }",
        ),
      ),
    ).toEqual([
      {
        rule: "seampact/derive/role-param-type",
        pointer: `${DERIVED}/schemaInvalid/params/tags`,
        related: [],
      },
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
