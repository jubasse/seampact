import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { REFUSED_SCHEMA_KEYWORDS } from "@seampact/spec/authoring";
import type { Origin } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import type { JsonObject, RawWorkspace } from "../raw-tree.js";
import { validateRules } from "./rules.js";
import {
  type ValidateDocumentKind,
  validateDocument,
  validateLayer,
  validateWorkspace,
} from "./validate.js";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURES = join(ROOT, "fixtures");

function read(path: string): { text: string; tree: JsonObject } {
  const text = readFileSync(path, "utf8");
  return { text, tree: parse(text) as JsonObject };
}

// The layer a fixture file stands for, from its top-level keys (ADR 0002 section 1).
function layerOf(tree: JsonObject): { kind: ValidateDocumentKind; layer: Origin["layer"] } {
  if ("api" in tree) return { kind: "api", layer: "api" };
  const pack = tree.pack as JsonObject | undefined;
  if (pack !== undefined) return { kind: "pack", layer: `pack:${String(pack.name)}` };
  return { kind: "base", layer: "shared" };
}

// `# expect: <rule> <pointer>` on a fixture's first line.
function expectation(text: string): { rule: string; pointer: string } {
  const m = /^# expect: (\S+) (\S*)/.exec(text);
  if (m === null) throw new Error("fixture without '# expect:'");
  return { rule: m[1] ?? "", pointer: m[2] ?? "" };
}

function files(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    })
    .sort();
}

function check(path: string) {
  const { text, tree } = read(path);
  const { kind, layer } = layerOf(tree);
  return { text, tree, layer, diagnostics: validateDocument(kind, tree, layer) };
}

const api = (route: JsonObject): JsonObject => ({
  api: { name: "tasks", version: 1 },
  surfaces: { app: { identity: "user", routes: { health: route } } },
});

describe("unknown keyword refused", () => {
  test("a misspelt route key names the closest keyword", () => {
    const [d, ...rest] = validateDocument("api", api({ method: "get", ouput: "Health" }), "api");
    expect(rest).toEqual([]);
    expect(d).toEqual({
      severity: "error",
      rule: validateRules.unknownKeyword,
      message: "'ouput' is not a keyword of 'health'.",
      fix: "Did you mean 'output'?",
      origin: { layer: "api", pointer: "/surfaces/app/routes/health/ouput" },
      related: [],
    });
  });

  test.each([
    [
      "a misspelt file key",
      { api: { name: "a", version: 1 }, surface: {} },
      "/surface",
      "surfaces",
    ],
    [
      "a misspelt catalogue entry key",
      { rights: { r: { gest: "why" } } },
      "/rights/r/gest",
      "guest",
    ],
    [
      "a misspelt convention",
      { conventions: { pathcase: "kebab" } },
      "/conventions/pathcase",
      "pathCase",
    ],
    [
      "a misspelt schema keyword",
      { schemas: { T: { type: "object", requird: [] } } },
      "/schemas/T/requird",
      "required",
    ],
    [
      "a misspelt op",
      api({ kind: "collection", id: { taskId: "TaskId" }, ops: { lst: {} } }),
      "/surfaces/app/routes/health/ops/lst",
      "list",
    ],
  ] as const)("%s", (_, tree, pointer, closest) => {
    const t = tree as unknown as JsonObject;
    const doc =
      "api" in t ? validateDocument("api", t, "api") : validateDocument("base", t, "shared");
    expect(doc).toHaveLength(1);
    expect(doc[0]?.rule).toBe(validateRules.unknownKeyword);
    expect(doc[0]?.origin.pointer).toBe(pointer);
    expect(doc[0]?.fix).toBe(`Did you mean '${closest}'?`);
  });

  test("a key far from every keyword lists the keywords instead", () => {
    const [d] = validateDocument("node", { method: "get", zzzzzz: 1 }, "api");
    expect(d?.rule).toBe(validateRules.unknownKeyword);
    expect(d?.fix).toMatch(/^Remove 'zzzzzz'/);
  });

  test("a misspelt key in a fragment kind", () => {
    const [d] = validateDocument("conventions", { paging: { maxLimt: 50 } }, "shared");
    expect(d?.origin.pointer).toBe("/paging/maxLimt");
    expect(d?.fix).toBe("Did you mean 'maxLimit'?");
  });
});

describe("refused keyword names its reason", () => {
  const dir = join(FIXTURES, "validate/refused");

  test("one fixture per refused keyword of ADR 0003", () => {
    const names = readdirSync(dir).map((f) => f.replace(/\.yaml$/, ""));
    expect(names.sort()).toEqual(REFUSED_SCHEMA_KEYWORDS.map((k) => k.keyword).sort());
  });

  test.each(REFUSED_SCHEMA_KEYWORDS.map((k) => [k.keyword, k] as const))("%s", (keyword, entry) => {
    const { diagnostics } = check(join(dir, `${keyword}.yaml`));
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d?.rule).toBe(validateRules.refusedKeyword);
    expect(d?.origin.pointer).toBe(`/schemas/Task/${keyword}`);
    expect(d?.message).toContain(entry.reason);
    expect(d?.fix.toLowerCase()).toContain(entry.fix.toLowerCase());
  });

  test.each([
    [
      "additionalProperties: false",
      { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
      "additionalProperties",
    ],
    ["a type array", { type: ["string", "null"] }, "type"],
    ["type: null", { type: "null" }, "type"],
    ["an inline enum", { enum: ["open", "done"] }, "enum"],
  ] as const)("a refused form: %s", (_, schema, keyword) => {
    const [d, ...rest] = validateDocument("schema", schema as unknown as JsonObject, "shared");
    expect(rest).toEqual([]);
    expect(d?.rule).toBe(validateRules.refusedKeyword);
    expect(d?.origin.pointer).toBe(`/${keyword}`);
  });

  test("a refused keyword deep in a schema position", () => {
    const tree = api({
      method: "post",
      input: {
        type: "object",
        properties: { tags: { type: "array", items: { type: "string" }, uniqueItems: true } },
      },
      output: "Task",
    });
    const [d] = validateDocument("api", tree, "api");
    expect(d?.rule).toBe(validateRules.refusedKeyword);
    expect(d?.origin.pointer).toBe("/surfaces/app/routes/health/input/properties/tags/uniqueItems");
  });
});

describe("reasons only on safety exceptions", () => {
  const accepted = files(join(FIXTURES, "validate/reasons/accepted"));
  const refused = files(join(FIXTURES, "validate/reasons/refused"));

  test("the CHK-142 set covers the six departures and the pack default", () => {
    expect(accepted.map((f) => relative(FIXTURES, f))).toEqual([
      "validate/reasons/accepted/local-enum.yaml",
      "validate/reasons/accepted/narrowing.yaml",
      "validate/reasons/accepted/no-path-version-convention.yaml",
      "validate/reasons/accepted/no-path-version-surface.yaml",
      "validate/reasons/accepted/node-format.yaml",
      "validate/reasons/accepted/pack-no-path-version.yaml",
      "validate/reasons/accepted/stated-maturity.yaml",
      "validate/reasons/accepted/unpaged-list.yaml",
    ]);
  });

  test.each(accepted.map((f) => [relative(FIXTURES, f), f]))(
    "accepts %s without a reason",
    (_, path) => {
      expect(check(path).diagnostics).toEqual([]);
    },
  );

  test.each(refused.map((f) => [relative(FIXTURES, f), f]))("refuses %s", (_, path) => {
    const { text, diagnostics } = check(path);
    const { rule, pointer } = expectation(text);
    expect(diagnostics.map((d) => [d.rule, d.origin.pointer])).toEqual([[rule, pointer]]);
  });
});

describe("pack schema refuses code and unknown keys", () => {
  const packs = files(join(FIXTURES, "validate/pack"));

  test.each(packs.map((f) => [relative(FIXTURES, f), f]))("%s", (_, path) => {
    const { text, layer, diagnostics } = check(path);
    const { rule, pointer } = expectation(text);
    expect(layer).toMatch(/^pack:/);
    expect(diagnostics.map((d) => [d.rule, d.origin.pointer])).toEqual([[rule, pointer]]);
  });

  test("a pack's unknown root key says a pack is data only", () => {
    const { diagnostics } = check(join(FIXTURES, "validate/pack/code.yaml"));
    expect(diagnostics[0]?.message).toContain("a pack is data only");
  });

  test("a pack holds every key of a base besides packs", () => {
    const tree = {
      pack: { name: "house", version: "2.1.0", extends: ["@seampact/pack-crud-rights"] },
      conventions: { rights: { pattern: "^[a-z]+(\\.[a-z]+)+$" } },
      headers: { deadline: { name: "X-Deadline", in: "request", semantic: "deadline" } },
      lint: { rules: { "seampact/credential-name": "disabled" } },
      derive: [{ entry: "crud", select: { op: ["get"] }, require: { right: "{resource}.{op}" } }],
    };
    expect(validateDocument("pack", tree, "pack:house")).toEqual([]);
  });
});

describe("reference contract validates", () => {
  const dir = join(FIXTURES, "reference");
  const kindOf = (path: string): ValidateDocumentKind | undefined => {
    const rel = relative(dir, path);
    if (rel === "workspace.yaml") return "workspace";
    if (rel.endsWith("/api.yaml")) return "api";
    if (rel.endsWith("base.yaml")) return "base";
    if (rel.endsWith("schemas.yaml")) return "schemas";
    if (rel.includes("/routes/")) return "node";
    return undefined;
  };
  const yamlFiles = files(dir).filter((f) => f.endsWith(".yaml"));

  test("every file of the reference contract has a kind", () => {
    expect(yamlFiles.filter((f) => kindOf(f) === undefined)).toEqual([]);
    expect(yamlFiles.length).toBe(7);
  });

  test.each(yamlFiles.map((f) => [relative(dir, f), f]))("%s", (_, path) => {
    const kind = kindOf(path) as ValidateDocumentKind;
    expect(validateDocument(kind, read(path).tree, kind === "api" ? "api" : "shared")).toEqual([]);
  });
});

describe("validate stage", () => {
  const layer = (name: Origin["layer"], file: string, tree: JsonObject) => ({
    layer: name,
    file,
    tree,
  });

  const workspaceOf = (apis: { name: string; layers: ReturnType<typeof layer>[] }[]) =>
    ({
      root: ".",
      locations: {},
      apis: apis.map((a) => ({ ...a, merged: {}, leafOrigins: {} })),
    }) satisfies RawWorkspace;

  test("validates the shared file once, under the first api that reaches it", () => {
    const shared = layer("shared", "shared/base.yaml", { conventions: { pathcase: "kebab" } });
    const workspace = workspaceOf(
      ["a", "b"].map((name) => ({
        name,
        layers: [shared, layer("api", `${name}/api.yaml`, { api: { name, version: 1 } })],
      })),
    );
    const result = validateWorkspace(workspace);
    expect(result.map((r) => r.api)).toEqual(["a", "b"]);
    expect(result[0]?.diagnostics.map((d) => d.origin)).toEqual([
      { layer: "shared", pointer: "/conventions/pathcase" },
    ]);
    expect(result[1]?.diagnostics).toEqual([]);
  });

  test("two failing api files stay apart, each under its api", () => {
    const workspace = workspaceOf(
      ["tasks", "tasksService"].map((name) => ({
        name,
        layers: [layer("api", `${name}/api.yaml`, { api: { name, version: 1 }, surface: {} })],
      })),
    );
    const result = validateWorkspace(workspace);
    expect(
      result.map((r) => [r.api, r.diagnostics.map((d) => [d.origin.layer, d.origin.pointer])]),
    ).toEqual([
      ["tasks", [["api", "/surface"]]],
      ["tasksService", [["api", "/surface"]]],
    ]);
  });

  test("a layer is validated against its kind", () => {
    const pack = layer("pack:house", "packs/house.yaml", {
      pack: { name: "house", version: "1.0.0" },
      surfaces: {},
    });
    expect(validateLayer(pack).map((d) => d.rule)).toEqual([validateRules.unknownKeyword]);
    const base = layer("base", "tasks/base.yaml", { derive: [] });
    expect(validateLayer(base).map((d) => d.origin.pointer)).toEqual(["/derive"]);
  });

  test("diagnostics come out sorted by layer, pointer, then rule, one per problem", () => {
    const tree = api({
      method: "get",
      zeta: 1,
      access: { public: "" },
      alpha: 1,
      output: { type: "object", properties: { a: { type: "string" } }, if: {} },
    });
    const diagnostics = validateDocument("api", tree, "api");
    expect(diagnostics.map((d) => [d.origin.pointer, d.rule])).toEqual([
      ["/surfaces/app/routes/health/access/public", validateRules.reasonRequired],
      ["/surfaces/app/routes/health/alpha", validateRules.unknownKeyword],
      ["/surfaces/app/routes/health/output/if", validateRules.refusedKeyword],
      ["/surfaces/app/routes/health/zeta", validateRules.unknownKeyword],
    ]);
    expect(validateDocument("api", tree, "api")).toEqual(diagnostics);
  });

  test.each([
    [
      "a node without a kind",
      api({ output: "Health" }),
      validateRules.missingKeyword,
      "/surfaces/app/routes/health",
    ],
    [
      "a name out of its pattern",
      { schemas: { task: { type: "string" } } },
      validateRules.invalidName,
      "/schemas/task",
    ],
    [
      "an identity name out of its pattern",
      api({ method: "get", identity: "User", output: "H" }),
      validateRules.invalidName,
      "/surfaces/app/routes/health/identity",
    ],
    [
      "$include in routes",
      { api: { name: "t", version: 1 }, surfaces: { app: { routes: { $include: "./r.yaml" } } } },
      validateRules.invalidName,
      "/surfaces/app/routes/$include",
    ],
    [
      "a wrong type",
      api({ method: "get", internal: "yes", output: "H" }),
      validateRules.wrongType,
      "/surfaces/app/routes/health/internal",
    ],
    [
      "a value outside its enum",
      api({ method: "fetch", output: "H" }),
      validateRules.invalidValue,
      "/surfaces/app/routes/health/method",
    ],
    [
      "public beside optionalAuth",
      api({ method: "get", access: { public: "a", optionalAuth: "b" }, output: "H" }),
      validateRules.conflictingKeywords,
      "/surfaces/app/routes/health/access/optionalAuth",
    ],
    [
      "a reserved extension prefix",
      { rights: { r: { "x-seampact-tier": 1 } } },
      validateRules.invalidName,
      "/rights/r/x-seampact-tier",
    ],
    [
      "a missing required key",
      { errors: { "api.gone": { title: "Gone." } } },
      validateRules.missingKeyword,
      "/errors/api.gone",
    ],
    [
      "a derive entry without effect",
      { pack: { name: "p", version: "1.0.0" }, derive: [{ entry: "e", select: {} }] },
      validateRules.missingKeyword,
      "/derive/0",
    ],
  ] as const)("%s", (_, tree, rule, pointer) => {
    const t = tree as unknown as JsonObject;
    const { kind, layer: l } = layerOf(t);
    const diagnostics = validateDocument(kind, t, l);
    expect(diagnostics.map((d) => [d.rule, d.origin.pointer])).toEqual([[rule, pointer]]);
    expect(diagnostics[0]?.message).not.toBe("");
    expect(diagnostics[0]?.fix).not.toBe("");
  });
});
