import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { check } from "./check.ts";
import { buildIds, exportFromDir, privateTerms } from "./export-ids.ts";
import { loadModel } from "./load.ts";
import type { Problem } from "./model.ts";
import { formatProblem } from "./model.ts";
import { parseResults, renderReport, shares, testPassed } from "./report.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const fx = (name: string) => join(HERE, "fixtures", name);
const lines = (problems: Problem[]) => problems.map(formatProblem);

const CHECKLIST = "docs/conformance/checklist.yaml";
const proofFile = "docs/conformance/proofs/lane-a.yaml";

/** Each failing fixture: the one problem expected, as file, id and message parts. */
function expectOne(name: string, file: string, id: string | undefined, part: string) {
  const out = lines(check({ root: fx(name) }));

  expect(out, name).toHaveLength(1);
  expect(out[0]).toContain(file);

  if (id) expect(out[0]).toContain(id);
  expect(out[0]).toContain(part);
}

describe("checklist check", () => {
  it("checklist check passes on the repository", () => {
    expect(lines(check({ root: REPO }))).toEqual([]);
  });

  it("passes on the reference fixture, with and without the release gate", () => {
    expect(check({ root: fx("ok") })).toEqual([]);
    expect(check({ root: fx("ok"), releaseGate: true })).toEqual([]);
  });

  it("malformed item refused", () => {
    expectOne("malformed-item", CHECKLIST, "CHK-001", "`fact` must be a non-empty string");
  });

  it("a proof of an item dropped by a load problem is not reported again", () => {
    expectOne(
      "malformed-item-with-proof",
      CHECKLIST,
      "CHK-001",
      "`fact` must be a non-empty string",
    );
  });

  it("duplicate id refused", () => {
    expectOne("duplicate-id", CHECKLIST, "CHK-001", "duplicate id");
  });

  it("id out of order refused", () => {
    expectOne("out-of-order", CHECKLIST, "CHK-001", "id out of order");
  });

  it("unknown fr refused", () => {
    expectOne("unknown-fr", CHECKLIST, "CHK-001", "unknown FR id FR-99");
  });

  it("unknown scenario refused", () => {
    expectOne("unknown-scenario", CHECKLIST, "CHK-001", "unknown scenario id SCN-099");
  });

  it("unknown target refused", () => {
    expectOne("unknown-target", CHECKLIST, "CHK-001", 'unknown target "cobol"');
  });

  it("fixture or tests inside the checklist refused", () => {
    expectOne("fixture-in-checklist", CHECKLIST, "CHK-001", "belongs in docs/conformance/proofs");
  });

  it("proof for an unknown id refused", () => {
    expectOne("proof-unknown-id", proofFile, "CHK-009", "unknown id");
  });

  it("proof for a retired id refused", () => {
    expectOne("proof-retired-id", proofFile, "CHK-002", "retired id");
  });

  it("missing fixture refused", () => {
    expectOne(
      "missing-fixture",
      proofFile,
      "CHK-001",
      "fixture path does not exist: data/missing.txt",
    );
  });

  it("missing test file refused", () => {
    expectOne(
      "missing-test-file",
      proofFile,
      "CHK-001",
      "test file does not exist: src/missing.test.txt",
    );
  });

  it("test for an unlisted target refused", () => {
    expectOne("unlisted-target", proofFile, "CHK-001", "target the item does not list: laravel");
  });

  it("malformed proof refused", () => {
    expectOne("malformed-proof", proofFile, "CHK-001", "malformed test");
  });

  it("proof lane must match its file name", () => {
    expectOne("lane-mismatch", proofFile, undefined, 'lane "lane-b" does not match');
  });

  it("consumer test paths are checked only with --consumers", () => {
    expect(check({ root: fx("consumer-tests") })).toEqual([]);
    const out = lines(
      check({ root: fx("consumer-tests"), consumers: fx("consumer-tests/consumers") }),
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toContain("test-seampact-nestjs/y.test.txt");
    expect(out[0]).toContain("CHK-001");
  });

  it("release gate names id and target", () => {
    expect(check({ root: fx("release-gate") })).toEqual([]);
    const out = lines(check({ root: fx("release-gate"), releaseGate: true }));

    expect(out).toContain(`${CHECKLIST}: CHK-001: release gate: no test for target nestjs`);
    expect(out).toContain(`${CHECKLIST}: CHK-002: release gate: no fixture`);

    for (const t of [
      "adonis",
      "api-platform",
      "express",
      "fastify",
      "laravel",
      "nestjs",
      "spring-boot",
      "symfony",
    ])
      expect(out).toContain(`${CHECKLIST}: CHK-002: release gate: no test for target ${t}`);
    expect(out.some((l) => l.includes("CHK-001") && l.includes("no fixture"))).toBe(false);
  });
});

describe("checklist check against a base ref", () => {
  const tmp = mkdtempSync(join(tmpdir(), "seampact-checklist-"));

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: tmp,
        encoding: "utf8",
      },
    );
  let original = "";

  beforeAll(() => {
    cpSync(fx("ok"), tmp, { recursive: true });
    git("init", "-q", "-b", "base");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    original = readFileSync(join(tmp, CHECKLIST), "utf8");
  });
  const edit = (text: string) => writeFileSync(join(tmp, CHECKLIST), text);

  it("renumbered id refused against base", () => {
    // CHK-001 renamed to CHK-000: the old id vanished and the new one sits below the base's highest.
    edit(original.replace("id: CHK-001", "id: CHK-000"));
    const out = lines(check({ root: tmp, base: "base" }));

    expect(out.some((l) => l.includes("CHK-001") && l.includes("removed instead of retired"))).toBe(
      true,
    );
    expect(out.some((l) => l.includes("CHK-000") && l.includes("renumbering"))).toBe(true);
  });

  it("a retired id may stay, a new highest id may be added", () => {
    edit(
      `${original}  - id: CHK-003\n    fact: New.\n    frs: [FR-1]\n    scenario: SCN-001\n    targets: [core]\n`,
    );
    expect(check({ root: tmp, base: "base" })).toEqual([]);
  });

  it("a retired id made live again is refused", () => {
    expect(original).toContain("retired:");
    edit(original.replace(/\n\s+retired:.*/, ""));
    const out = lines(check({ root: tmp, base: "base" }));

    expect(out).toHaveLength(1);
    expect(out[0]).toContain("CHK-002");
    expect(out[0]).toContain("retired at base but live again");
  });

  it("an unknown base ref fails loudly", () => {
    edit(original);
    expect(() => check({ root: tmp, base: "no-such-ref" })).toThrow(/no-such-ref/);
  });
});

describe("checklist report", () => {
  const problems: Problem[] = [];
  const model = loadModel(fx("report"), problems);

  it("report shares per target", () => {
    expect(problems).toEqual([]);
    const byTarget = Object.fromEntries(shares(model, fx("report")).map((s) => [s.target, s]));

    // server expands to eight targets; CHK-001 has a fixture and core and nestjs tests.
    expect(byTarget.core).toMatchObject({ items: 2, fixtures: 2, tests: 2 });
    expect(byTarget.nestjs).toMatchObject({ items: 2, fixtures: 2, tests: 1 });
    expect(byTarget.fastify).toMatchObject({ items: 1, fixtures: 1, tests: 0 });
    expect(shares(model, fx("report")).map((s) => s.target)).toEqual(
      [...shares(model, fx("report")).map((s) => s.target)].sort(),
    );
    const text = renderReport(model, fx("report"));

    expect(text).toContain("| core | 2 | 2/2 (100.0%) | 2/2 (100.0%) |");
    expect(text).toContain("| fastify | 1 | 1/1 (100.0%) | 0/1 (0.0%) |");
    expect(renderReport(model, fx("report"))).toBe(text);
  });

  it("counts only passing tests with results", () => {
    // The fixture names its test file "<root>/...": results hold absolute paths.
    const results = parseResults(
      readFileSync(join(fx("report"), "results.json"), "utf8").replaceAll("<root>", fx("report")),
    );
    const byTarget = Object.fromEntries(
      shares(model, fx("report"), results).map((s) => [s.target, s]),
    );

    // CHK-002's only test fails, so its fixture and test do not count; CHK-003 names no test.
    expect(byTarget.core).toMatchObject({ items: 2, fixtures: 1, tests: 1 });
    expect(byTarget.nestjs).toMatchObject({ items: 2, fixtures: 1, tests: 1 });
  });

  it("a test passes only with a matching assertion and no failure, in the exact file", () => {
    const ref = { raw: "", target: "core", path: "src/a.test.ts", name: "works" };
    const run = (name: string, ...statuses: string[]) => ({
      name,
      assertionResults: statuses.map((status) => ({ title: "works", status })),
    });
    const at = (...files: ReturnType<typeof run>[]) => ({ testResults: files });

    expect(testPassed(ref, "/r", at(run("/r/src/a.test.ts", "passed")))).toBe(true);
    // One passed and one failed assertion of the same title: not passed.
    expect(testPassed(ref, "/r", at(run("/r/src/a.test.ts", "passed", "failed")))).toBe(false);
    // No assertion of that name, and the same name in another directory's file: not passed.
    expect(testPassed(ref, "/r", at())).toBe(false);
    expect(testPassed(ref, "/r", at(run("/r/other/src/a.test.ts", "passed")))).toBe(false);
  });
});

describe("ids export", () => {
  const committed = readFileSync(join(REPO, "docs/conformance/ids.yaml"), "utf8");

  it("ids export has no private detail", () => {
    // Forbidden terms come from SEAMPACT_PRIVATE_TERMS or an untracked file, never from source.
    const lower = committed.toLowerCase();

    for (const term of privateTerms()) expect(lower).not.toContain(term);
    const prd = { features: [{ id: "FR-1", name: "Loading" }] };
    const clean = { scenarios: [{ id: "SCN-025", title: "A neutral title" }] };
    const leaky = { scenarios: [{ id: "SCN-025", title: "Runs at Zorblax scale" }] };

    expect(buildIds(prd, clean, ["zorblax"])).toContain("SCN-025");
    expect(() => buildIds(prd, leaky, ["zorblax"])).toThrow(/private term/);
    expect(privateTerms({ SEAMPACT_PRIVATE_TERMS: "Zorblax, Other" }, "/nonexistent")).toEqual([
      "zorblax",
      "other",
    ]);
  });

  it("holds FR-1 to FR-42 and every scenario the checklist cites", () => {
    const ids = parse(committed) as {
      frs: Record<string, string>;
      scenarios: Record<string, string>;
    };

    for (let n = 1; n <= 42; n++) expect(ids.frs).toHaveProperty(`FR-${n}`);
    expect(Object.keys(ids)).toEqual(["frs", "scenarios"]);
    const sorted = (o: Record<string, string>) => Object.keys(o);

    expect(sorted(ids.frs)).toEqual(
      [...sorted(ids.frs)].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))),
    );
    expect(sorted(ids.scenarios)).toEqual([...sorted(ids.scenarios)].sort());
  });

  it("a malformed framing is refused", () => {
    expect(() => buildIds({ features: [{ id: "FR-1" }] }, { scenarios: [] })).toThrow(/FR-1/);
  });

  const favir = process.env.SEAMPACT_FAVIR_DIR;

  it.skipIf(!favir)("matches the framing when the framing directory is present", () => {
    expect(exportFromDir(favir as string)).toBe(committed);
  });
});

describe("checklist cli", () => {
  const run = (...args: string[]) =>
    execFileSync("node", [join(HERE, "cli.ts"), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  it("check and report run on the repository", () => {
    expect(run("check")).toBe("");
    expect(run("report")).toContain("| Target | Live items |");
  });

  it("check exits non-zero and names the problem", () => {
    let stderr = "";

    try {
      run("check", "--root", fx("unknown-fr"));
    } catch (e) {
      stderr = String((e as { stderr: unknown }).stderr);
    }

    expect(stderr).toContain("CHK-001");
    expect(stderr).toContain("unknown FR id FR-99");
  });
});
