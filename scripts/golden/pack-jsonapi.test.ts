import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadGoldenCompiler } from "./compiler.ts";
import { GOLDEN_DIRECTORY } from "./golden.ts";
import { REPO_ROOT } from "./repo-root.ts";

// `pack-jsonapi` has no golden case yet: this loads it on a copy of the hal variant so a pack file that does not
// parse or resolve fails here.

const compiler = await loadGoldenCompiler();
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe("pack-jsonapi", () => {
  it("loads as a pack of a workspace", () => {
    const root = mkdtempSync(join(REPO_ROOT, "fixtures/jsonapi-load-"));

    temporaryRoots.push(root);
    cpSync(join(REPO_ROOT, GOLDEN_DIRECTORY, "pack-hal/contract"), root, { recursive: true });

    const shared = join(root, "shared/base.yaml");

    writeFileSync(shared, readFileSync(shared, "utf8").replace("pack-hal", "pack-jsonapi"));

    const tasks = join(root, "tasks/api.yaml");

    writeFileSync(tasks, readFileSync(tasks, "utf8").replace("halPages", "jsonapiPages"));

    const rules = compiler
      .compile(root, "workspace.yaml")
      .apis.flatMap((api) => api.problems)
      .flatMap((problem) => problem.match(/error (seampact\/\S+):/)?.[1] ?? []);

    // The reference has ops the format cannot serve (no id property, no collection), which is a contract fault, not a pack fault.
    expect(new Set(rules)).toEqual(
      new Set(["seampact/tree/format-id", "seampact/tree/template-slot"]),
    );
  });
});
