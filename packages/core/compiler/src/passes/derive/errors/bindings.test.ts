import { describe, expect, test } from "vitest";
import type { DerivationRoleName } from "../../../derivations/index.js";
import { pipelineTreeNodes, type TreeNode } from "../../../pipeline/seam.js";
import { type DeriveErrorsBinding, deriveErrorsBindingAt } from "./bindings.js";
import {
  type DeriveErrorsRun,
  deriveErrorsLoadFiles,
  deriveErrorsLoadFixture,
  deriveErrorsLocated,
  deriveErrorsRunContract,
} from "./test-support.js";

const PING_SURFACE = `
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks role bindings only. }
    routes:
      ping: { method: get }
`;

function nodeAt(run: DeriveErrorsRun, pointer: string): TreeNode {
  const node = pipelineTreeNodes(run.context.raw).find(
    (candidate) => candidate.pointer === pointer,
  );

  if (node === undefined) throw new Error(`the contract has no node at ${pointer}`);

  return node;
}

const bindingAt = (
  run: DeriveErrorsRun,
  pointer: string,
  role: DerivationRoleName,
): Pick<DeriveErrorsBinding, "code" | "pointer"> => {
  const { code, pointer: at } = deriveErrorsBindingAt(run.context, nodeAt(run, pointer), role);

  return { code, ...(at === undefined ? {} : { pointer: at }) };
};

const runInline = (body: string): DeriveErrorsRun =>
  deriveErrorsRunContract(
    deriveErrorsLoadFiles({
      "api.yaml": `api: { name: shop, version: 1 }\n${body}${PING_SURFACE}`,
    }),
  );

describe("role bindings", () => {
  test("the nearest errorRoles binding wins, then the conventions (a pack's included), then the default", () => {
    const run = deriveErrorsRunContract(deriveErrorsLoadFixture("bindings"));
    const members = "/surfaces/app/routes/members";

    expect(run.diagnostics).toEqual([]);
    expect(bindingAt(run, `${members}/member/routes/history`, "notFound")).toEqual({
      code: "members.gone",
      pointer: `${members}/member/routes/history/errorRoles/notFound`,
    });
    expect(bindingAt(run, `${members}/ops/get`, "notFound")).toEqual({
      code: "members.not_found",
      pointer: `${members}/member/errorRoles/notFound`,
    });
    expect(bindingAt(run, `${members}/ops/list`, "notFound")).toEqual({
      code: "pack.not_found",
      pointer: "/conventions/errors/derived/notFound",
    });
    expect(run.context.origin("/conventions/errors/derived/notFound")?.layer).toBe(
      "pack:errors-pack",
    );
    expect(bindingAt(run, `${members}/ops/list`, "forbidden")).toEqual({ code: "api.forbidden" });
  });

  test("a { code, params } template carries the role's data to params of other names", () => {
    const run = deriveErrorsRunContract(deriveErrorsLoadFixture("bindings"));
    const binding = deriveErrorsBindingAt(
      run.context,
      nodeAt(run, "/surfaces/app/routes/members/ops/list"),
      "schemaInvalid",
    );

    expect(binding).toMatchObject({
      code: "shop.invalid",
      params: { problems: { $each: "$issues", $as: { at: "$item.pointer" } } },
    });
  });

  test("a binding to an unregistered code is refused at the binding", () => {
    const run = runInline(`conventions: { errors: { derived: { notFound: shop.missing } } }\n`);

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-code",
        pointer: "/conventions/errors/derived/notFound",
        related: [],
      },
    ]);
    expect(run.diagnostics[0]?.message).toContain("'notFound'");
    expect(run.diagnostics[0]?.message).toContain("'shop.missing'");
  });

  test("an errorRoles binding to an unregistered code is refused at the node", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks role bindings only. }
    errorRoles: { forbidden: { code: shop.denied } }
    routes:
      ping: { method: get }
`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-code",
        pointer: "/surfaces/app/errorRoles/forbidden",
        related: [],
      },
    ]);
  });

  test("a bound code whose params cannot receive a required datum is refused naming the role, the datum and the code", () => {
    const run =
      runInline(`conventions: { errors: { derived: { sortKeyForbidden: shop.sort_denied } } }
errors:
  shop.sort_denied: { status: 403, params: { detail: { type: string } } }
`);

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-datum",
        pointer: "/conventions/errors/derived/sortKeyForbidden",
        related: [],
      },
    ]);
    expect(run.diagnostics[0]?.message).toBe(
      "role 'sortKeyForbidden' requires the datum 'key', which no param of 'shop.sort_denied' receives",
    );
  });

  test("a template that reads no required datum, or only a literal dollar, is refused", () => {
    const run = runInline(`conventions:
  errors:
    derived:
      sortKeyForbidden: { code: shop.sort_denied, params: { detail: [$$key, '$keys', 3] } }
errors:
  shop.sort_denied: { status: 403, params: { detail: { type: array, items: { type: string } } } }
`);

    expect(run.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "seampact/derive/role-datum",
    ]);
  });

  test("a template reaches a datum as a slot, a member slot or a text slot filling a param", () => {
    for (const params of [
      "{ detail: $key }",
      "{ detail: [$key.text] }",
      `{ detail: 'key \${key}' }`,
    ]) {
      const run = runInline(`conventions:
  errors: { derived: { sortKeyForbidden: { code: shop.sort_denied, params: ${params} } } }
errors:
  shop.sort_denied: { status: 403, params: { detail: { type: string } } }
`);

      expect(run.diagnostics).toEqual([]);
    }
  });

  test("a datum written to a key that is no param of the code is refused at the key", () => {
    for (const declaration of [
      "{ status: 403 }",
      "{ status: 403, params: { detail: { type: string } } }",
    ]) {
      const run = runInline(`conventions:
  errors: { derived: { sortKeyForbidden: { code: shop.sort_denied, params: { other: $key } } } }
errors:
  shop.sort_denied: ${declaration}
`);

      expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
        {
          rule: "seampact/derive/role-param",
          pointer: "/conventions/errors/derived/sortKeyForbidden/params/other",
          related: [],
        },
      ]);
    }
  });

  test("a literal dollar key names no param", () => {
    const run = runInline(`conventions:
  errors: { derived: { sortKeyForbidden: { code: shop.sort_denied, params: { $$key: $key } } } }
errors:
  shop.sort_denied: { status: 403, params: { key: { type: string } } }
`);

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-param",
        pointer: "/conventions/errors/derived/sortKeyForbidden/params/$$key",
        related: [],
      },
    ]);
  });

  test("a params template that is no object is refused at params", () => {
    const run = runInline(`conventions:
  errors: { derived: { sortKeyForbidden: { code: shop.sort_denied, params: $key } } }
errors:
  shop.sort_denied: { status: 403, params: { key: { type: string } } }
`);

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-param",
        pointer: "/conventions/errors/derived/sortKeyForbidden/params",
        related: [],
      },
    ]);
  });

  test("rateLimited's delay is required once conventions.rateLimit names it", () => {
    const declared = "errors:\n  shop.slow_down: { status: 429 }\n";
    const binding = "  errors: { derived: { rateLimited: shop.slow_down } }\n";
    const without = runInline(`conventions:\n${binding}${declared}`);
    const named = runInline(
      `conventions:\n  rateLimit: { header: Retry-After, param: retryAfterMs, unit: s }\n${binding}${declared}`,
    );

    expect(without.diagnostics).toEqual([]);
    expect(named.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-datum",
        pointer: "/conventions/errors/derived/rateLimited",
        related: [],
      },
    ]);
  });

  test("rateLimited requires the param conventions.rateLimit names, not a fixed name", () => {
    const binding = "  errors: { derived: { rateLimited: shop.slow_down } }\n";
    const run = (carried: string) =>
      runInline(
        `conventions:\n  rateLimit: { header: Retry-After, param: delayMs, unit: s }\n${binding}errors:\n  shop.slow_down: { status: 429, params: { ${carried}: { type: integer } } }\n`,
      );

    expect(run("delayMs").diagnostics).toEqual([]);
    expect(run("retryAfterMs").diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-datum",
        pointer: "/conventions/errors/derived/rateLimited",
        related: [],
      },
    ]);
  });

  test("a default code redeclared with params that drop a required datum is refused at the declaration", () => {
    const run = runInline(`errors:
  api.sort_key_forbidden: { status: 403, params: { detail: { type: string } } }
`);

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-datum",
        pointer: "/errors/api.sort_key_forbidden",
        related: [],
      },
    ]);
  });

  test("a redeclared default code also bound on a node by name is reported once, at the node binding", () => {
    const run = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": `api: { name: shop, version: 1 }
errors:
  api.sort_key_forbidden: { status: 403, params: { detail: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    access: { public: The contract checks role bindings only. }
    errorRoles: { sortKeyForbidden: api.sort_key_forbidden }
    routes:
      ping: { method: get }
`,
      }),
    );

    expect(run.diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/role-datum",
        pointer: "/surfaces/app/errorRoles/sortKeyForbidden",
        related: [],
      },
    ]);
  });
});
