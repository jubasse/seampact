import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { REFUSED_SCHEMA_KEYWORDS } from "@seampact/spec/authoring";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { loadFsReader, loadWorkspace } from "../load/index.js";
import type { ApiLayerId, FileLayerId, JsonObject, RawApi, RawWorkspace } from "../raw-tree.js";
import { MAX_DIAGNOSTICS } from "./diagnostics.js";
import { validateRules } from "./rules.js";
import {
  type ValidateDocumentKind,
  validateDocument,
  validateLayer,
  validateWorkspace,
} from "./validate.js";

const ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const FIXTURES = join(ROOT, "fixtures");

function read(path: string): { text: string; tree: JsonObject } {
  const text = readFileSync(path, "utf8");

  return { text, tree: parse(text) as JsonObject };
}

// The layer a fixture file stands for, from its top-level keys (ADR 0002 section 1).
function layerOf(tree: JsonObject): { kind: ValidateDocumentKind; layer: FileLayerId } {
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
  const layer = (name: ApiLayerId, file: string, tree: JsonObject) => ({
    layer: name,
    file,
    tree,
  });

  const workspaceOf = (apis: { name: string; layers: ReturnType<typeof layer>[] }[]) =>
    ({
      root: ".",
      locations: {},
      apis: apis.map((a) => ({
        ...a,
        merged: {},
        leafOrigins: {},
        locations: {},
        // The validate stage never reads visibility; the Record type requires the fixed layer keys.
        visibility: {} as RawApi["visibility"],
      })),
    }) satisfies RawWorkspace;

  test("validates the shared file once, under the first api that reaches it", () => {
    const shared = layer("shared", "shared/base.yaml", { conventions: { pathcase: "kebab" } });
    const workspace = workspaceOf(
      ["a", "b"].map((name) => ({
        name,
        layers: [shared, layer("api", `${name}/api.yaml`, { api: { name, version: 1 } })],
      })),
    );
    const { workspace: own, apis: result } = validateWorkspace(workspace);

    expect(own).toEqual([]);
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
    const result = validateWorkspace(workspace).apis;

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

// C-4: the reference contract is ADR 0002's Worked example, file for file.
describe("reference contract is the ADR's worked example", () => {
  const dir = join(FIXTURES, "reference");
  // Files the ADR names without showing them, written for this fixture (see the lane report).
  const BEYOND_THE_ADR = ["tasks/examples/search-200.json", "tasks/schemas.yaml"];
  const adr = readFileSync(join(ROOT, "docs/grammar/example.md"), "utf8");
  const start = adr.indexOf("\n## Worked example");
  const section = adr.slice(start, adr.indexOf("\n## ", start + 1));
  const blocks = new Map<string, string>();

  for (const m of section.matchAll(/```yaml\n([\s\S]*?)```/g)) {
    const body = m[1] ?? "";
    const path = /^# ([\w./-]+\.(?:yaml|json))(?::|$)/m.exec(body.split("\n")[0] ?? "")?.[1];

    if (path !== undefined) blocks.set(path, body);
  }

  test("every file is shown by the ADR or listed as written beyond it", () => {
    const fixtures = files(dir).map((f) => relative(dir, f));

    expect(fixtures.filter((f) => !blocks.has(f) && !BEYOND_THE_ADR.includes(f))).toEqual([]);
    expect([...blocks.keys()].filter((p) => !fixtures.includes(p))).toEqual([]);
    expect(BEYOND_THE_ADR.filter((p) => blocks.has(p))).toEqual([]);
  });

  test.each([...blocks.keys()])("%s is the ADR's block, byte for byte", (path) => {
    expect(readFileSync(join(dir, path), "utf8")).toBe(blocks.get(path));
  });
});

describe("one diagnostic per problem", () => {
  test.each([
    [
      "a misspelt node kind",
      api({ kind: "colection", item: "Task" }),
      validateRules.invalidValue,
      "/surfaces/app/routes/health/kind",
    ],
    [
      "a misspelt scheme kind",
      { schemes: { session: { kind: "coookie", name: "sid" } } },
      validateRules.invalidValue,
      "/schemes/session/kind",
    ],
    [
      "a scheme without a kind",
      { schemes: { session: { name: "sid" } } },
      validateRules.missingKeyword,
      "/schemes/session",
    ],
    [
      "an included node with a key no node has",
      api({ $include: "./health.yaml", ouput: "Health" }),
      validateRules.unknownKeyword,
      "/surfaces/app/routes/health/ouput",
    ],
    [
      "a derive require without right or rule",
      { pack: { name: "p", version: "1.0.0" }, derive: [{ entry: "e", select: {}, require: {} }] },
      validateRules.missingKeyword,
      "/derive/0/require",
    ],
    [
      "an import without a source",
      { workspace: { imports: { billing: { api: "billing", integrity: "sha256-x" } } } },
      validateRules.missingKeyword,
      "/workspace/imports/billing",
    ],
    [
      "an import with two sources",
      {
        workspace: {
          imports: {
            billing: {
              api: "billing",
              integrity: "sha256-x",
              package: "@acme/c",
              version: "1.0.0",
              git: { url: "https://x", tag: "v1" },
            },
          },
        },
      },
      validateRules.conflictingKeywords,
      "/workspace/imports/billing/git",
    ],
    [
      "an unknown keys exception holding both",
      { schemas: { T: { type: "object", unknownKeys: { ignore: "a", keep: "b" } } } },
      validateRules.conflictingKeywords,
      "/schemas/T/unknownKeys/keep",
    ],
    [
      "an empty unknown keys exception",
      { schemas: { T: { type: "object", unknownKeys: {} } } },
      validateRules.reasonRequired,
      "/schemas/T/unknownKeys",
    ],
    [
      "a derive entry with an effect but no select",
      { pack: { name: "p", version: "1.0.0" }, derive: [{ entry: "e", attachErrors: [] }] },
      validateRules.missingKeyword,
      "/derive/0",
    ],
    [
      "a requirement with a right and a bucket",
      api({ method: "get", requires: [{ right: "tasks.read", bucket: "b" }] }),
      validateRules.conflictingKeywords,
      "/surfaces/app/routes/health/requires/0/bucket",
    ],
  ] as const)("%s", (_, tree, rule, pointer) => {
    const t = tree as unknown as JsonObject;
    const kind: ValidateDocumentKind = "workspace" in t ? "workspace" : layerOf(t).kind;
    const diagnostics = validateDocument(kind, t, layerOf(t).layer);

    expect(diagnostics.map((d) => [d.rule, d.origin.pointer])).toEqual([[rule, pointer]]);
  });
});

describe("messages name the problem", () => {
  const one = (kind: ValidateDocumentKind, tree: unknown) => {
    const diagnostics = validateDocument(kind, tree as JsonObject, "shared");

    expect(diagnostics).toHaveLength(1);

    return diagnostics[0] as NonNullable<(typeof diagnostics)[0]>;
  };

  test("a value of neither accepted type", () => {
    const d = one("node", { method: "get", paging: 3 });

    expect(d.rule).toBe(validateRules.wrongType);
    expect(d.message).toBe("'paging' must be a string or a mapping.");
  });

  test("a constant", () => {
    const d = one("node", { method: "get", concurrency: "own" });

    expect(d.message).toBe(`'concurrency' is 'own'; its one value is "inherit".`);
  });

  test("two keys where one is taken", () => {
    const d = one("node", { method: "get", paging: { cursor: {}, offset: {} } });

    expect(d.rule).toBe(validateRules.conflictingKeywords);
    expect(d.message).toBe("'paging' takes one key, not 'cursor', 'offset'.");
  });

  test("two styles beside $include: the bound counts the styles only", () => {
    const d = one("node", {
      method: "get",
      paging: { $include: "./p.yaml", cursor: {}, offset: {} },
    });

    expect(d.message).toBe("'paging' takes one key, not 'cursor', 'offset'.");
  });

  test("a derive entry without an effect", () => {
    const d = one("pack", {
      pack: { name: "p", version: "1.0.0" },
      derive: [{ entry: "e", select: {} }],
    });

    expect([d.rule, d.origin.pointer]).toEqual([validateRules.missingKeyword, "/derive/0"]);
    expect(d.fix).toBe("Add 'declareRight', 'require' or 'attachErrors'.");
  });

  // The fix spells the reasoned form with the key that holds it.
  test.each([
    [
      "conventions.query.unknownKeys",
      "conventions",
      { query: { unknownKeys: {} } },
      'Write unknownKeys: { ignore: "<reason>" }.',
    ],
    [
      "unknownQuery",
      "node",
      { method: "get", unknownQuery: {} },
      'Write unknownQuery: { ignore: "<reason>" }.',
    ],
    [
      "a schema's unknownKeys",
      "schema",
      { type: "object", unknownKeys: {} },
      'Write unknownKeys: { ignore: "<reason>" } or unknownKeys: { keep: "<reason>" }.',
    ],
    ["csrf", "node", { method: "post", csrf: {} }, 'Write csrf: { exempt: "<reason>" }.'],
  ] as const)("a missing reason in %s", (_, kind, tree, fix) => {
    const d = one(kind, tree);

    expect(d.rule).toBe(validateRules.reasonRequired);
    expect(d.fix).toBe(fix);
  });

  test("a string where only a reasoned exception is accepted", () => {
    const d = one("identities", { hook: { kind: "signed", unknownKeys: "refuse" } });

    expect(d.rule).toBe(validateRules.invalidValue);
    expect(d.message).toBe("'unknownKeys' takes no string here, only a reasoned exception.");
  });

  test("no Ajv wording reaches a message", () => {
    const trees: [ValidateDocumentKind, unknown][] = [
      ["node", { method: "get", paging: 3 }],
      ["node", { method: "get", concurrency: "own" }],
      ["node", { method: "get", paging: { cursor: {}, offset: {} } }],
      ["identities", { hook: { kind: "signed", unknownKeys: "refuse" } }],
    ];

    for (const [kind, tree] of trees) {
      for (const d of validateDocument(kind, tree as JsonObject, "shared")) {
        expect(d.message).not.toMatch(/must NOT|equal to constant|must match/);
      }
    }
  });

  test("$include in routes is the one refusal of $include", () => {
    const d = one("node", { kind: "single", routes: { $include: "./r.yaml" } });

    expect(d.message).toContain("every child of a routes map is named in its parent");
    expect(
      validateDocument("node", { method: "get", responses: { $include: "./r.yaml" } }, "api"),
    ).toEqual([]);
  });

  test("a misnamed key cites the ADR section of its pattern", () => {
    expect(one("node", { method: "get", responses: { 404: {} } }).message).toBe(
      "'404' is not a success or redirect status (ADR 0002 section 7).",
    );
    expect(one("schemas", { task: { type: "string" } }).message).toBe(
      "'task' is not a schema name (ADR 0002 section 4).",
    );
  });
});

describe("authored values in diagnostics", () => {
  test("control, bidi and separator characters are escaped", () => {
    const [esc, rlo, ls] = [0x1b, 0x202e, 0x2028].map((c) => String.fromCharCode(c));
    const key = `a${esc}[31mred${rlo}b${ls}c\nd`;
    const [d] = validateDocument("node", { method: "get", [key]: 1 }, "api");

    expect(d?.message).toBe(
      "'a\\u001B[31mred\\u202Eb\\u2028c\\u000Ad' is not a keyword of the file's root.",
    );
    expect(
      [...(d?.fix ?? "")].some((c) => [0x1b, 0x0a, 0x202e, 0x2028].includes(c.charCodeAt(0))),
    ).toBe(false);
  });

  test("a long value is cut, and gets no closest keyword", () => {
    const key = `ouput${"x".repeat(200)}`;
    const [d] = validateDocument("node", { method: "get", [key]: 1 }, "api");

    expect(d?.message.length).toBeLessThan(140);
    expect(d?.message).toContain(String.fromCharCode(0x2026));
    expect(d?.fix).toMatch(/^Remove '/);
  });

  test("a value in an enum message is quoted and escaped", () => {
    const [d] = validateDocument("node", { method: "ge\u0007t" }, "api");

    expect(d?.message).toBe("'method' is 'ge\\u0007t', not one of its values.");
  });

  test(`a file far from the grammar gives at most ${MAX_DIAGNOSTICS} diagnostics`, () => {
    const tree = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));

    expect(validateDocument("node", { method: "get", ...tree }, "api")).toHaveLength(
      MAX_DIAGNOSTICS,
    );
  });
});

// One fixture per name, each in another position: a free key, a name key, a right name in use.
describe("reserved names refused", () => {
  const dir = join(FIXTURES, "validate/reserved");

  test.each(["__proto__", "constructor", "prototype"])("%s", (name) => {
    const { text, diagnostics } = check(join(dir, `${name}.yaml`));
    const { rule, pointer } = expectation(text);

    expect(diagnostics.map((d) => [d.rule, d.origin.pointer])).toEqual([[rule, pointer]]);
    expect(diagnostics[0]?.message).toBe(
      `'${name}' is a reserved name: it reaches the prototype of a JavaScript object, so no key or right name may be __proto__, constructor, prototype.`,
    );
  });

  // JSON text, so `__proto__` is an own key, the way the loader's trees hold it.
  test.each([
    [
      "a catalogue name",
      '{ "buckets": { "constructor": { "limit": 1, "per": "1m" } } }',
      "/buckets/constructor",
    ],
    ["an extension prefix", '{ "extensions": { "prototype": {} } }', "/extensions/prototype"],
    ["a right", '{ "rights": { "__proto__": {} } }', "/rights/__proto__"],
  ] as const)("in %s", (_, json, pointer) => {
    const t = JSON.parse(json) as JsonObject;

    expect(validateDocument("base", t, "shared").map((d) => [d.rule, d.origin.pointer])).toEqual([
      [validateRules.invalidName, pointer],
    ]);
  });
});

// The stage runs on the loader's trees, whose `$include`s are resolved (validate.ts, contract with
// the loader): end to end from the files.
describe("load then validate", () => {
  const loaded = (root: string, entry: string) => {
    const result = loadWorkspace({ reader: loadFsReader(join(FIXTURES, root)), entry });

    expect(result.diagnostics).toEqual([]);

    return result.workspace;
  };

  test("the reference contract loads and validates", () => {
    expect(validateWorkspace(loaded("reference", "workspace.yaml"))).toEqual({
      workspace: [],
      apis: [
        { api: "tasks", diagnostics: [] },
        { api: "tasksService", diagnostics: [] },
      ],
    });
  });

  // C-13: the file alone passes ($include relieves the mapping of its keys); once the loader has
  // resolved the include, the empty reason is refused, at a pointer the api's table locates.
  test("an access brought by $include is checked after resolution", () => {
    const path = join(FIXTURES, "validate/include/access-route.yaml");
    const { text, tree } = read(path);

    expect(validateDocument("api", tree, "api")).toEqual([]);
    const workspace = loaded("validate/include", "access-route.yaml");
    const [entry, ...others] = validateWorkspace(workspace).apis;

    expect(others).toEqual([]);
    const { rule, pointer } = expectation(text);

    expect(entry?.diagnostics.map((d) => [d.rule, d.origin.pointer])).toEqual([[rule, pointer]]);
    expect(workspace.apis[0]?.locations[`api#${pointer}`]).toBeDefined();
  });
});
