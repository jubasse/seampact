import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCartography,
  CARTOGRAPHY_FILE,
  COMPILER_STAGES,
  type CompilerStage,
  WRITE_COMMAND,
} from "./map.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CLI = join(HERE, "cli.ts");

const NO_STAGES: CompilerStage[] = [];

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A throwaway repository holding the given files, keyed by repository-relative path. */
function repositoryWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "cartography-"));
  temporaryRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function manifest(name: string | undefined, description?: string, role?: string): string {
  return JSON.stringify({
    name,
    ...(description === undefined ? {} : { description }),
    ...(role === undefined ? {} : { seampact: { role } }),
  });
}

function runCli(root: string, ...flags: string[]) {
  const run = spawnSync(process.execPath, [CLI, ...flags, "--root", root], { encoding: "utf8" });
  return { status: run.status, stderr: run.stderr };
}

describe("cartography", () => {
  it("the committed map is current", () => {
    const { markdown, problems } = buildCartography({ root: REPO, stages: COMPILER_STAGES });

    expect(problems).toEqual([]);
    expect(readFileSync(join(REPO, CARTOGRAPHY_FILE), "utf8")).toBe(markdown);
  });

  it("takes each line from the index comment, the README or the package description", () => {
    const root = repositoryWith({
      "packages/alpha/package.json": manifest("@x/alpha", "Alpha does things.", "core"),
      "packages/alpha/src/index.ts": "export {};\n",
      "packages/alpha/src/load/index.ts":
        "// The load stage: files read\n// into trees. More detail here.\n\nexport {};\n",
      "packages/alpha/src/grammar/README.md": "# Grammar modules, one per file kind\n",
      "packages/alpha/src/grammar/files.ts": "export {};\n",
      "packages/alpha/src/passes/tree/index.ts": "// The tree pass.\nexport {};\n",
      "packages/alpha/src/load/fixtures/case/index.ts": "export {};\n",
    });

    const { markdown, problems } = buildCartography({ root, stages: NO_STAGES });

    expect(problems).toEqual([]);
    expect(markdown).toContain("| `@x/alpha` | `packages/alpha` | core | Alpha does things. |");
    expect(markdown).toContain("- `packages/alpha/src`: Alpha does things.");
    expect(markdown).toContain(
      "- `packages/alpha/src/load`: The load stage: files read into trees.",
    );
    expect(markdown).toContain(
      "- `packages/alpha/src/grammar`: Grammar modules, one per file kind",
    );
    expect(markdown).toContain("- `packages/alpha/src/passes/tree`: The tree pass.");
    expect(markdown).not.toContain("`packages/alpha/src/passes`:");
    expect(markdown).not.toContain("fixtures");
  });

  it("orders packages and directories by code unit and writes no timestamp", () => {
    const root = repositoryWith({
      "packages/b/package.json": manifest("@x/b", "B.", "core"),
      "packages/a/package.json": manifest("@x/a", "A.", "core"),
      "packages/a/src/index.ts": "export {};\n",
      "packages/a/src/zeta/index.ts": "// Zeta.\n",
      "packages/a/src/Beta/index.ts": "// Beta.\n",
      "packages/a/src/alpha/index.ts": "// Alpha.\n",
    });

    const first = buildCartography({ root, stages: NO_STAGES }).markdown;
    const second = buildCartography({ root, stages: NO_STAGES }).markdown;

    expect(second).toBe(first);
    expect(first.indexOf("`@x/a`")).toBeLessThan(first.indexOf("`@x/b`"));
    const order = ["src/Beta`", "src/alpha`", "src/zeta`"].map((path) => first.indexOf(path));
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("reports a directory without a header and a package without description or role", () => {
    const root = repositoryWith({
      "packages/alpha/package.json": manifest("@x/alpha"),
      "packages/alpha/src/index.ts": "export {};\n",
      "packages/alpha/src/load/index.ts": "export {};\n",
    });

    const { problems } = buildCartography({ root, stages: NO_STAGES });

    expect(problems).toEqual([
      "packages/alpha/package.json: no `description`; add a one-line description of the package",
      "packages/alpha/package.json: no `seampact.role`; add the package's role",
      "packages/alpha/src/load: no header; add a one-line comment at the top of packages/alpha/src/load/index.ts, or a README.md",
      "packages/alpha/src: no header; add a one-line comment at the top of packages/alpha/src/index.ts, or a README.md",
    ]);
  });

  it("reports a package.json that is not valid JSON or has no name", () => {
    const root = repositoryWith({
      "packages/alpha/package.json": "{ not json",
      "packages/beta/package.json": manifest(undefined, "Beta.", "core"),
    });

    const { problems } = buildCartography({ root, stages: NO_STAGES });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(
      /^packages\/alpha\/package\.json: not valid JSON \(.+\); fix the file$/,
    );
    expect(problems[1]).toBe("packages/beta/package.json: no `name`; add the package name");
  });

  it("reports a missing stage directory", () => {
    const root = repositoryWith({ "packages/alpha/package.json": manifest("@x/a", "A.", "core") });
    const stages = [{ name: "load", directories: ["packages/alpha/src/load"] }];

    const { problems } = buildCartography({ root, stages });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('packages/alpha/src/load: the directory of stage "load"');
  });

  it("--check fails on a stale map and names the fix, --write makes it current", () => {
    const root = repositoryWith({
      "packages/compiler/package.json": manifest("@x/compiler", "Compiler.", "core"),
      ...Object.fromEntries(
        COMPILER_STAGES.flatMap((stage) => stage.directories).map((directory) => [
          `${directory}/index.ts`,
          "// A stage.\n",
        ]),
      ),
    });

    const missing = runCli(root, "--check");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain(`${CARTOGRAPHY_FILE} is missing; run \`${WRITE_COMMAND}\``);

    expect(runCli(root, "--write").status).toBe(0);
    expect(runCli(root, "--check")).toEqual({ status: 0, stderr: "cartography: ok\n" });

    writeFileSync(join(root, "packages/compiler/src/load/index.ts"), "// The load stage.\n");
    const stale = runCli(root, "--check");
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain(`${CARTOGRAPHY_FILE} is stale; run \`${WRITE_COMMAND}\``);
  });

  it("exits 2 with the usage on an unknown or missing flag", () => {
    const root = repositoryWith({});

    for (const flags of [["--check", "--bogus"], []]) {
      const run = runCli(root, ...flags);

      expect(run.status).toBe(2);
      expect(run.stderr).toContain("usage: node scripts/cartography/cli.ts (--write | --check)");
      expect(run.stderr).not.toContain("    at ");
    }
  });

  it("exits 1 and writes nothing when there are problems, in both modes", () => {
    const root = repositoryWith({
      "packages/alpha/package.json": manifest("@x/alpha"),
    });

    for (const mode of ["--write", "--check"]) {
      const run = runCli(root, mode);

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("no `description`");
      expect(run.stderr).toContain(`${CARTOGRAPHY_FILE} left unchanged`);
      expect(existsSync(join(root, CARTOGRAPHY_FILE))).toBe(false);
    }
  });
});
