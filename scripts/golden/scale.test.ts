import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findStaleFiles } from "../ir-models/generate.ts";
import { type LoadedApi, loadGoldenCompiler } from "./compiler.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { GENERATED_SURFACES, generateScaleFiles, SCALE_DIRECTORY } from "./scale.ts";
import {
  enumUseCounts,
  scaleCounts,
  surfaceOperationCount,
  unreachableDeclarations,
} from "./scale-counts.ts";
import { DOMAIN_ENUMS } from "./scale-words.ts";

const compiler = await loadGoldenCompiler();
const scale = compiler.loadValidated(join(REPO_ROOT, SCALE_DIRECTORY), "workspace.yaml");
const reference = compiler.loadValidated(join(REPO_ROOT, "fixtures/reference"), "workspace.yaml");

function apiNamed(apis: readonly LoadedApi[], name: string): LoadedApi {
  const api = apis.find((each) => each.name === name);

  if (api === undefined) throw new Error(`the workspace holds no api ${name}`);

  return api;
}

describe("scale fixture", () => {
  it("is valid for the validate stage", () => {
    expect(scale.problems).toEqual([]);
    expect(scale.apis.map((api) => api.name)).toEqual(["inventory", "billing", "notify"]);
  });

  it("scale fixture volumes", () => {
    const counts = scaleCounts(scale.apis, GENERATED_SURFACES);

    expect(counts.operations).toEqual({ inventory: 93, billing: 90, notify: 13 });
    expect(counts.handWrittenOperations).toBeGreaterThanOrEqual(30);
    expect(counts.identities).toBe(4);
    expect(counts.schemes).toBe(5);
  });

  it("scale schemas and examples", () => {
    const counts = scaleCounts(scale.apis, GENERATED_SURFACES);

    expect(counts.schemas).toBe(241);
    expect(counts.examples).toBe(119);
  });

  it("scale error codes", () => {
    const counts = scaleCounts(scale.apis, GENERATED_SURFACES);

    expect(counts.errorCodes).toBe(112);
    expect(counts.errorFamilies).toBe(11);
  });

  it("reuses every enum densely", () => {
    const uses = enumUseCounts(scale.apis);

    for (const { name } of DOMAIN_ENUMS) expect(uses[name], name).toBeGreaterThanOrEqual(4);
  });

  it("holds no declaration a route does not reach", () => {
    expect(unreachableDeclarations(scale.apis)).toEqual([]);
  });

  it("names a declaration no route reaches", () => {
    const api = apiNamed(scale.apis, "notify");
    const withoutRoutes: LoadedApi = { ...api, merged: { ...api.merged, surfaces: {} } };

    expect(unreachableDeclarations([withoutRoutes])).toContain("schemas.Template");
  });

  it("has no name of a real customer", () => {
    const files = generateScaleFiles();

    expect([...files.values()].filter((text) => /arthome/i.test(text))).toEqual([]);
  });

  it("generated scale files are current", () => {
    expect(findStaleFiles(generateScaleFiles(), REPO_ROOT)).toEqual([]);
  });

  it("generates the same files twice", () => {
    expect(generateScaleFiles()).toEqual(generateScaleFiles());
  });
});

describe("operation counting", () => {
  it("counts the operations of the reference contract", () => {
    const tasks = apiNamed(reference.apis, "tasks");

    expect(reference.problems).toEqual([]);
    expect(scaleCounts([tasks], {}).operations).toEqual({ tasks: 17 });
  });

  it("counts a method route, an ops list and an ops map", () => {
    const surface = {
      routes: {
        one: { method: "get" },
        list: { kind: "collection", ops: ["list", "get"] },
        map: { kind: "collection", ops: { list: {}, get: {}, batch: {} } },
      },
    };

    expect(surfaceOperationCount(surface)).toBe(6);
  });
});
