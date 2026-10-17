import { canonicalId } from "@seampact/spec/naming";
import { describe, expect, test } from "vitest";
import { derivationCoreSchemaIds } from "../../../derivations/index.js";
import { treeSchemasRules, treeSchemasRunApi } from "./test-support.js";

const ONE_SCHEMA = "schemas:\n  A: { type: object, properties: { a: { type: string } } }\n";
const text = { kind: "scalar", type: "string", refinements: {} };
const count = { kind: "scalar", type: "integer", refinements: { minimum: "0" } };
const core = (pointer: string) => ({ layer: "core", pointer });
const api = (pointer: string) => ({ layer: "api", pointer });

const coreProperty = (name: string, type: object, optional: boolean, pointer: string) => ({
  name,
  type,
  optional,
  nullable: false,
  sensitive: false,
  deprecated: false,
  docs: {},
  extensions: {},
  origin: core(pointer),
});

const coreIds = (catalogues: string) =>
  Object.values(treeSchemasRunApi(catalogues).draft.schemas)
    .filter((schema) => schema.origin.layer === "core")
    .map((schema) => schema.id);

describe("core declarations and reserved ids", () => {
  test("every core schema is seeded with its core origin, its ids those of the role data", () => {
    const run = treeSchemasRunApi(ONE_SCHEMA);

    expect(run.diagnostics).toEqual([]);
    const seeded = Object.values(run.draft.schemas).filter((s) => s.origin.layer === "core");

    expect(seeded.map((schema) => schema.id)).toEqual([...derivationCoreSchemaIds]);

    for (const schema of seeded) {
      const role = schema.name.role === "params" ? "params" : "schema";

      expect(["params", "schema"]).toContain(schema.name.role);
      expect(canonicalId({ segments: schema.name.segments, role })).toBe(schema.id);
      expect(schema).not.toHaveProperty("derivedFrom");
    }
  });

  test("each core schema has the params, issue members and directions of ADR 0006 section 6", () => {
    const { schemas } = treeSchemasRunApi(ONE_SCHEMA).draft;
    const issue = "/errors/api.schema_invalid/params/issues/items";

    expect(schemas.ApiSchemaInvalidParams).toEqual({
      kind: "object",
      id: "ApiSchemaInvalidParams",
      name: { segments: ["api", "schema", "invalid"], role: "params" },
      directions: ["output"],
      examples: [],
      docs: {},
      extensions: {},
      origin: core("/errors/api.schema_invalid/params"),
      properties: [
        coreProperty(
          "issues",
          { kind: "array", items: { kind: "ref", schema: "ApiSchemaInvalidIssue" } },
          false,
          "/errors/api.schema_invalid/params/issues",
        ),
      ],
    });
    expect(schemas.ApiSchemaInvalidIssue).toMatchObject({
      name: { segments: ["api", "schema", "invalid", "issue"], role: "schema" },
      directions: ["output"],
      origin: core(issue),
      properties: [
        coreProperty(
          "in",
          {
            kind: "scalar",
            type: "string",
            refinements: {
              pattern: {
                source: "^(?:path|query|header|body)$",
                normalized: "^(?:path|query|header|body)$",
              },
            },
          },
          false,
          `${issue}/properties/in`,
        ),
        coreProperty("pointer", text, false, `${issue}/properties/pointer`),
        coreProperty("rule", text, false, `${issue}/properties/rule`),
      ],
    });
    expect(schemas.ApiRateLimitedParams).toMatchObject({
      directions: ["output"],
      properties: [
        coreProperty("retryAfterMs", count, true, "/errors/api.rate_limited/params/retryAfterMs"),
      ],
    });
    expect(schemas.ApiEmptyBody).toEqual({
      kind: "object",
      id: "ApiEmptyBody",
      name: { segments: ["api", "empty", "body"], role: "schema" },
      directions: ["input"],
      examples: [],
      docs: {},
      extensions: {},
      origin: core("/schemas/ApiEmptyBody"),
      properties: [],
    });
  });

  test("the seeded data is a copy: changing one run's schema leaves the next run's", () => {
    const first = treeSchemasRunApi(ONE_SCHEMA).draft.schemas.ApiRateLimitedParams;

    if (first?.kind === "object" && first.properties[0] !== undefined)
      first.properties[0].type = { kind: "scalar", type: "boolean", refinements: {} };
    const next = treeSchemasRunApi(ONE_SCHEMA).draft.schemas.ApiRateLimitedParams;

    expect(next?.kind === "object" ? next.properties[0]?.type : undefined).toEqual(count);
  });

  test("a default code declared with params takes the reserved id; one declared without keeps the core schema", () => {
    const run = treeSchemasRunApi(`errors:
  api.forbidden: { status: 403, params: { pointer: { type: string }, field: { type: string } } }
  api.sort_key_forbidden: { status: 403, title: Sort key refused }
`);

    expect(run.diagnostics).toEqual([]);
    expect(run.draft.schemas.ApiForbiddenParams).toMatchObject({
      origin: api("/errors/api.forbidden/params"),
      properties: [{ name: "pointer" }, { name: "field" }],
    });
    expect(run.draft.schemas.ApiSortKeyForbiddenParams?.origin).toEqual(
      core("/errors/api.sort_key_forbidden/params"),
    );
  });

  test("the issue schema stays seeded after the schema_invalid params are replaced, until a layer takes its id", () => {
    const reused = treeSchemasRunApi(`errors:
  api.schema_invalid: { status: 400, params: { issues: { type: array, items: ApiSchemaInvalidIssue } } }
`);

    expect(reused.diagnostics).toEqual([]);
    expect(reused.draft.schemas.ApiSchemaInvalidIssue?.origin.layer).toBe("core");
    expect(reused.draft.schemas.ApiSchemaInvalidParams?.origin).toEqual(
      api("/errors/api.schema_invalid/params"),
    );
  });

  test("the issue schema may be taken by a layer once the schema_invalid params are replaced", () => {
    const rateLimited =
      "errors:\n  api.rate_limited: { status: 429, params: { after: { type: string } } }\n";

    expect(coreIds(rateLimited)).toContain("ApiSchemaInvalidIssue");

    const replaced = treeSchemasRunApi(`errors:
  api.schema_invalid: { status: 400, params: { issues: { type: array, items: ApiSchemaInvalidIssue } } }
schemas:
  ApiSchemaInvalidIssue: { type: object, properties: { message: { type: string } } }
`);

    expect(replaced.diagnostics).toEqual([]);
    expect(replaced.draft.schemas.ApiSchemaInvalidIssue?.origin).toEqual(
      api("/schemas/ApiSchemaInvalidIssue"),
    );
    expect(replaced.draft.schemas.ApiSchemaInvalidParams?.origin).toEqual(
      api("/errors/api.schema_invalid/params"),
    );
  });

  test.each([
    ["ApiEmptyBody", "the empty body of a proof-only input"],
    ["ApiRateLimitedParams", "the params of the default code 'api.rate_limited'"],
    ["ApiSchemaInvalidIssue", "one issue of the default code 'api.schema_invalid'"],
  ])("a declared %s is refused, naming the reservation", (id, purpose) => {
    const run = treeSchemasRunApi(
      `schemas:\n  ${id}: { type: object, properties: { a: { type: string } } }\n`,
    );

    expect(run.diagnostics.map((d) => [d.rule, d.origin, d.message, d.fix])).toEqual([
      [
        "seampact/tree/schema-reserved",
        api(`/schemas/${id}`),
        `the schema '${id}' is reserved for ${purpose}`,
        "declare the schema under another name",
      ],
    ]);
    expect(run.draft.schemas[id]?.origin.layer).toBe("core");
    expect(run.located).toBe(true);
  });

  test("a declared schema whose identifier equals a reserved one is refused", () => {
    const run = treeSchemasRunApi(
      "schemas:\n  APIEmptyBody: { type: object, properties: { a: { type: string } } }\n",
    );

    expect(treeSchemasRules(run)).toEqual(["schema-reserved"]);
    expect(run.diagnostics[0]?.message).toBe(
      "the schema 'APIEmptyBody' gives the same identifier as 'ApiEmptyBody', reserved for the empty body of a proof-only input",
    );
    expect(run.draft.schemas.APIEmptyBody).toBeUndefined();
  });

  test("a declared schema named like replaced params is still refused", () => {
    const run = treeSchemasRunApi(`errors:
  api.forbidden: { status: 403, params: ApiForbiddenParams }
schemas:
  ApiForbiddenParams: { type: object, properties: { pointer: { type: string } } }
`);

    expect(treeSchemasRules(run)).toEqual(["schema-reserved"]);
  });

  test.each([
    [
      "rights:\n  api.rate_limited: { params: { a: { type: string } } }\n",
      "/rights/api.rate_limited/params",
      "rename the schema, or the right, rule or error",
      [],
    ],
    [
      "errors:\n  api.forbidden: { status: 403, params: { a: { type: string } } }\nrules:\n  apiForbidden: { params: { a: { type: string } } }\n",
      "/rules/apiForbidden/params",
      "rename the schema, or the right, rule or error",
      [
        {
          message: "the params of 'ApiForbiddenParams' take the id here",
          origin: api("/errors/api.forbidden/params"),
        },
      ],
    ],
    [
      "schemas:\n  Api: { type: object, properties: { emptyBody: { type: object, properties: { a: { type: string } } } } }\n",
      "/schemas/Api/properties/emptyBody",
      "rename the schema or the property",
      [],
    ],
  ])("a hoist landing on a reserved id is refused (%#)", (catalogues, pointer, fix, related) => {
    const run = treeSchemasRunApi(catalogues);

    expect(run.diagnostics.map((d) => [d.rule, d.origin, d.fix, d.related])).toEqual([
      ["seampact/tree/schema-reserved", api(pointer), fix, related],
    ]);
    expect(run.located).toBe(true);
  });

  test.each([
    ["ApiEmptyBody then APIEmptyBody", ["ApiEmptyBody", "APIEmptyBody"]],
    ["APIEmptyBody then ApiEmptyBody", ["APIEmptyBody", "ApiEmptyBody"]],
  ])("both spellings of a reserved identifier are refused: %s", (_label, ids) => {
    const run = treeSchemasRunApi(
      `schemas:\n${ids.map((id) => `  ${id}: { type: object, properties: { a: { type: string } } }\n`).join("")}`,
    );

    expect(run.diagnostics.map((d) => [d.rule, d.origin])).toEqual(
      ids.map((id) => ["seampact/tree/schema-reserved", api(`/schemas/${id}`)]),
    );
    expect(Object.values(run.draft.schemas).map((schema) => schema.origin.layer)).not.toContain(
      "api",
    );
  });

  test("a hoist refused on an id the layer params took names those params", () => {
    const run = treeSchemasRunApi(`errors:
  api.forbidden: { status: 403, params: { a: { type: string } } }
rights:
  api.forbidden: { params: { a: { type: string } } }
`);

    expect(run.diagnostics.map((d) => [d.rule, d.origin, d.related.map((r) => r.origin)])).toEqual([
      [
        "seampact/tree/schema-reserved",
        api("/rights/api.forbidden/params"),
        [api("/errors/api.forbidden/params")],
      ],
    ]);
  });

  test("a use of a refused reserved declaration is not resolved to the core schema", () => {
    const run = treeSchemasRunApi(`schemas:
  ApiEmptyBody: { type: object, properties: { a: { type: string } } }
  Holder: { type: object, properties: { x: ApiEmptyBody } }
`);

    expect(treeSchemasRules(run)).toEqual(["schema-reserved"]);
    expect(run.draft.schemas.Holder).toBeUndefined();
  });
});
