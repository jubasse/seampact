import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findStaleFiles } from "../ir-models/generate.ts";
import { loadGoldenCompiler } from "./compiler.ts";
import { findUnlistedFiles, type GoldenCase, goldenFiles } from "./golden.ts";
import { REPO_ROOT } from "./repo-root.ts";

const compiler = await loadGoldenCompiler();
const SPEC_EXAMPLES = join(REPO_ROOT, "packages/core/spec/schemas/ir/examples");
const TOY_CASE: GoldenCase = { name: "toy", source: "src", entry: "api.yaml" };
const TOY_CONTRACT = `api: { name: toy, version: 1 }
surfaces:
  app:
    prefix: /v{version}
    routes:
      health:
        method: get
        access: { public: "Probes call it." }
        output: { type: object, required: [ok], properties: { ok: { type: boolean } } }
`;

// The pipeline is unfinished while this lane starts, so the toy case runs the real load, validate and passes and
// replaces only finalize with the IR and side table the spec ships as examples.
const toyParts = {
  finalize: () => ({
    ir: JSON.parse(readFileSync(join(SPEC_EXAMPLES, "minimal.ir.json"), "utf8")),
    sourceMap: JSON.parse(readFileSync(join(SPEC_EXAMPLES, "minimal.source-map.json"), "utf8")),
  }),
};

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function toyRoot(contract: string = TOY_CONTRACT): string {
  const root = mkdtempSync(join(tmpdir(), "golden-"));

  temporaryRoots.push(root);
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/api.yaml"), contract);

  return root;
}

function writeAll(root: string, files: Map<string, string>): void {
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

describe("golden checker on a toy case", () => {
  it("golden IR matches", () => {
    const root = toyRoot();
    const { files, problems } = goldenFiles(root, [TOY_CASE], compiler, toyParts);

    expect(problems).toEqual([]);
    expect([...files.keys()]).toEqual([
      "fixtures/golden/toy/toy.ir.json",
      "fixtures/golden/toy/toy.source-map.json",
    ]);

    writeAll(root, files);

    expect(findStaleFiles(files, root)).toEqual([]);
    expect(findUnlistedFiles(files, root)).toEqual([]);
    expect(goldenFiles(root, [TOY_CASE], compiler, toyParts).files).toEqual(files);
  });

  it("golden checker refuses stale files", () => {
    const root = toyRoot();
    const { files } = goldenFiles(root, [TOY_CASE], compiler, toyParts);

    writeAll(root, files);
    writeFileSync(join(root, "fixtures/golden/toy/toy.ir.json"), "{}\n");
    rmSync(join(root, "fixtures/golden/toy/toy.source-map.json"));
    writeFileSync(join(root, "fixtures/golden/toy/extra.ir.json"), "{}\n");

    expect(findStaleFiles(files, root)).toEqual([
      "fixtures/golden/toy/toy.ir.json is stale",
      "fixtures/golden/toy/toy.source-map.json is missing",
    ]);
    expect(findUnlistedFiles(files, root)).toEqual(["fixtures/golden/toy/extra.ir.json"]);
  });

  it("names the case and the rule of a contract that does not validate", () => {
    const root = toyRoot(`${TOY_CONTRACT}unknownKey: 1\n`);
    const { files, problems } = goldenFiles(root, [TOY_CASE], compiler, toyParts);

    expect(files.size).toBe(0);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^toy\/toy: api\.yaml:\d+:\d+: error seampact\/validate\/[a-z-]+: /,
    );
  });

  it("reports an api that finalize produced no IR for", () => {
    const root = toyRoot();
    const { files, problems } = goldenFiles(root, [TOY_CASE], compiler, {
      finalize: () => undefined,
    });

    expect(files.size).toBe(0);
    expect(problems).toEqual(["toy/toy: the compiler produced no IR"]);
  });
});
