import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadGoldenCompiler } from "./compiler.ts";
import { REPO_ROOT } from "./repo-root.ts";
import { type ContractVariant, contractVariant, readContractTrees } from "./variants.ts";

// CHK-103 (FR-9): the reference contract with random mappings moved to `$include` files and random example
// values moved to `$file` files compiles to the golden IR bytes. A failing seed is in the message: pass it to
// `contractVariant(trees, seed, true)` to replay it.

const compiler = await loadGoldenCompiler();
const REFERENCE_ROOT = join(REPO_ROOT, "fixtures/reference");
// Compiling every variant takes over 30 s on a loaded machine.
const VARIANTS_TIMEOUT_MILLISECONDS = 60_000;
const REFERENCE_FILES = [
  "workspace.yaml",
  "shared/base.yaml",
  "shared/schemas.yaml",
  "tasks/api.yaml",
  "tasks-service/api.yaml",
];
const GOLDEN_APIS = ["tasks", "tasksService"];
const VARIANT_COUNT = 60;
const MINIMUM_MOVING_VARIANTS = 50;

const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function writeVariant(variant: ContractVariant): string {
  const root = mkdtempSync(join(tmpdir(), "golden-variant-"));

  temporaryRoots.push(root);

  for (const [path, content] of variant.files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  return root;
}

function compiledIrTexts(variant: ContractVariant, label: string): Map<string, string> {
  const compiled = compiler.compile(writeVariant(variant), "workspace.yaml");

  expect(compiled.problems, label).toEqual([]);

  return new Map(
    compiled.apis.map((api) => {
      expect(api.problems, `${label} ${api.api}`).toEqual([]);

      return [api.api, api.files?.irText ?? ""];
    }),
  );
}

describe("inline and included declarations", () => {
  const trees = readContractTrees(
    REFERENCE_ROOT,
    // The shared schemas file is reached by `$include` only: its content joins the base through the trees.
    REFERENCE_FILES.filter((file) => file !== "shared/schemas.yaml"),
  );
  const golden = new Map(
    GOLDEN_APIS.map((api) => [
      api,
      readFileSync(join(REPO_ROOT, `fixtures/golden/reference/${api}.ir.json`), "utf8"),
    ]),
  );

  it("write the reference folder back whole to the golden bytes", () => {
    expect(compiledIrTexts(contractVariant(trees, 0, false), "whole")).toEqual(golden);
  });

  it("give one IR", () => {
    let movingVariants = 0;
    let includeDirectives = 0;
    let fileDirectives = 0;

    for (let seed = 1; seed <= VARIANT_COUNT; seed++) {
      const variant = contractVariant(trees, seed, true);

      if (variant.includeDirectives + variant.fileDirectives > 0) movingVariants++;

      includeDirectives += variant.includeDirectives;
      fileDirectives += variant.fileDirectives;

      expect(compiledIrTexts(variant, `seed ${seed}`), `seed ${seed}`).toEqual(golden);
    }

    expect(movingVariants).toBeGreaterThanOrEqual(MINIMUM_MOVING_VARIANTS);
    expect(includeDirectives).toBeGreaterThan(0);
    expect(fileDirectives).toBeGreaterThan(0);
  }, VARIANTS_TIMEOUT_MILLISECONDS);
});
