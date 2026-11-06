import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  outsideTargetsReason,
  parseSuiteCase,
} from "../../packages/tools/http-suite/src/suite-case.ts";
import {
  type CaseResult,
  suiteReportOf,
} from "../../packages/tools/http-suite/src/suite-report.ts";
import { caseHeader, refusedResult } from "../../packages/tools/http-suite/src/suite-runner.ts";
import type { CheckOptions } from "./check.ts";
import { check } from "./check.ts";
import { buildIds, exportFromDir, privateTerms } from "./export-ids.ts";
import { loadModel } from "./load.ts";
import type { Problem } from "./model.ts";
import { formatProblem } from "./model.ts";
import { ITEMS_AFTER_1_0, indexItemsAfter1_0, TARGETS_AFTER_1_0 } from "./release-scope.ts";
import { parseResults, renderReport, shares, testPassed } from "./report.ts";
import { SUITE_CONSUMERS, suiteConsumerProblems } from "./suite-consumers.ts";
import { SERVER_TARGETS } from "./targets.ts";
import { VARIANT_ROW_SETS } from "./variant-rows.ts";

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
    expect(
      lines(
        check({ root: REPO, itemsAfter1_0: ITEMS_AFTER_1_0, variantRowSets: VARIANT_ROW_SETS }),
      ),
    ).toEqual([]);
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

    for (const t of ["adonis", "express", "fastify", "laravel", "nestjs", "spring-boot", "symfony"])
      expect(out).toContain(`${CHECKLIST}: CHK-002: release gate: no test for target ${t}`);
    expect(out.some((l) => l.includes("CHK-001") && l.includes("no fixture"))).toBe(false);
  });
});

const MALFORMED_ENTRY =
  "malformed suite report entry: needs a CHK id, an outcome and the case ids (at least one when passed)";

describe("checklist release gate with suite reports", () => {
  const reports = (name: string) => join(fx("suite-reports"), name);
  const gate = (suiteReports: string) =>
    lines(check({ root: fx("release-gate"), releaseGate: true, suiteReports }));
  const noTest = (id: string, target: string) =>
    `${CHECKLIST}: ${id}: release gate: no test for target ${target}`;

  it("a passed suite report proves its target and the fixture", () => {
    const out = gate(reports("proving"));

    expect(out).not.toContain(noTest("CHK-001", "nestjs"));
    expect(out).not.toContain(noTest("CHK-002", "spring-boot"));
    expect(out).not.toContain(`${CHECKLIST}: CHK-002: release gate: no fixture`);
    expect(out).toContain(noTest("CHK-002", "express"));
  });

  it("names a failed and a refused suite run", () => {
    const out = gate(reports("proving"));
    const fastifyReport = join(reports("proving"), "fastify/http-suite-default.json");

    expect(out).toContain(
      `${fastifyReport}: CHK-002: release gate: failed for target fastify in this suite report`,
    );
    expect(out).not.toContain(noTest("CHK-002", "fastify"));
    expect(out).toContain(`${noTest("CHK-002", "nestjs")} (its suite run refused the id)`);
  });

  it("refuses a file that is not a report of a server target, and each bad entry", () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-suite-"));

    try {
      cpSync(reports("refused"), directory, { recursive: true });
      writeFileSync(join(directory, "http-suite-broken.json"), '{ "format": ');
      const out = gate(directory);
      const at = (file: string) => out.filter((l) => l.startsWith(join(directory, file)));

      expect(at("http-suite-broken.json")[0]).toContain("not valid JSON");
      expect(at("http-suite-not-a-report.json")[0]).toContain("not an http-suite report");
      expect(at("http-suite-unknown-target.json")[0]).toContain(
        'unknown server target "nestjs-esm"',
      );
      expect(at("http-suite-entries.json")).toEqual([
        `${join(directory, "http-suite-entries.json")}: CHK-002: ${MALFORMED_ENTRY}`,
        `${join(directory, "http-suite-entries.json")}: CHK-001: suite report of a target the item does not list: express (item lists core, nestjs)`,
        `${join(directory, "http-suite-entries.json")}: CHK-009: suite report proves an unknown id (not in the checklist)`,
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** Runs the gate over a directory holding the given reports, as `http-suite-<name>.json` files. */
  function gateOver(files: Record<string, unknown>): string[] {
    const directory = mkdtempSync(join(tmpdir(), "checklist-suite-"));

    try {
      for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(directory, `http-suite-${name}.json`), JSON.stringify(content));
      }

      return gate(directory).map((line) => line.replaceAll(directory, "<dir>"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  const reportOf = (target: string, checks: Record<string, unknown>) => ({
    format: "seampact-http-suite-report/1",
    target,
    profile: "default",
    checks,
  });

  it("prints no raw report value: a line break cannot start a workflow command", () => {
    const injected = "x\n::error::injected\n";
    const out = gateOver({
      target: reportOf(injected, {}),
      entry: reportOf("nestjs", { [`${injected}`]: { outcome: "passed", cases: ["a"] } }),
    });
    const printed = out.join("\n");

    expect(printed).toContain("unknown server target");
    expect(printed).toContain(MALFORMED_ENTRY);
    expect(printed.split("\n").filter((line) => line.startsWith("::"))).toEqual([]);
    expect(printed).not.toContain("injected\n");
  });

  it("escapes backticks and cuts a long value", () => {
    const out = gateOver({ target: reportOf(`\`\`\`${"y".repeat(100)}`, {}) }).join("\n");

    expect(out).not.toContain("`");
    expect(out).toContain("\\u0060\\u0060\\u0060yyy");
    expect(out).not.toContain("y".repeat(60));
  });

  it("counts a checks entry only when its shape is a result with case ids", () => {
    const out = gateOver({
      shapes: reportOf("nestjs", {
        "CHK-001": { outcome: "passed", cases: [] },
        "CHK-002": { outcome: "passed", cases: "case-a" },
      }),
    });

    expect(out.filter((l) => l.includes(MALFORMED_ENTRY))).toHaveLength(2);
    expect(out).toContain(noTest("CHK-001", "nestjs"));
  });

  it("reads a report of a target variant as its target", () => {
    const passed = { outcome: "passed", cases: ["a"] };
    const out = gateOver({
      cjs: reportOf("nestjs-cjs", { "CHK-001": passed }),
      adonis: reportOf("adonis6", { "CHK-002": passed }),
      express: reportOf("express4", { "CHK-002": passed }),
    });

    expect(out).not.toContain(noTest("CHK-001", "nestjs"));
    expect(out).not.toContain(noTest("CHK-002", "adonis"));
    expect(out).not.toContain(noTest("CHK-002", "express"));
    expect(out.filter((line) => line.includes("unknown server target"))).toEqual([]);
  });

  it("still names an unknown target, listing the variants it accepts", () => {
    const out = gateOver({ other: reportOf("nestjs-esm", {}) });

    expect(out.join("\n")).toContain('unknown server target "nestjs-esm"');
    expect(out.join("\n")).toContain("nestjs-cjs");
  });

  it("does not require api-platform, which comes after 1.0", () => {
    const out = gateOver({});

    expect(out).not.toContain(noTest("CHK-002", "api-platform"));
    expect(out).toContain(noTest("CHK-002", "express"));
  });

  it("reads only http-suite-*.json files of an artefact", () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-suite-"));

    try {
      writeFileSync(join(directory, "package.json"), "{}");
      writeFileSync(
        join(directory, "http-suite-default.json"),
        JSON.stringify(reportOf("nestjs", { "CHK-001": { outcome: "passed", cases: ["a"] } })),
      );

      expect(gate(directory).filter((l) => l.includes("package.json"))).toEqual([]);
      expect(gate(directory)).not.toContain(noTest("CHK-001", "nestjs"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("a failed report wins over a passed one of the same target", () => {
    const out = gateOver({
      a: reportOf("nestjs", { "CHK-001": { outcome: "passed", cases: ["a"] } }),
      b: reportOf("nestjs", { "CHK-001": { outcome: "failed", cases: ["a"] } }),
    });

    expect(out).toContain(
      `<dir>/http-suite-b.json: CHK-001: release gate: failed for target nestjs in this suite report`,
    );
    expect(out).not.toContain(noTest("CHK-001", "nestjs"));
  });

  it("refuses a directory without any report", () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-suite-"));

    try {
      expect(gate(directory)).toContain(
        `${directory}: -: no http-suite report (http-suite-*.json) under the directory`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("the cli takes suite reports only with the release gate", () => {
    const run = () =>
      execFileSync(
        process.execPath,
        [
          join(HERE, "cli.ts"),
          "check",
          "--root",
          fx("release-gate"),
          "--suite-reports",
          reports("proving"),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );

    expect(run).toThrow(/--suite-reports reads proofs for the release gate only/);
  });
});

const hasJq = spawnSync("jq", ["--version"]).status === 0;

describe.skipIf(!hasJq)("suite report fetcher filters", () => {
  const filter = (file: string, input: unknown, commit = "", runs = ""): string =>
    execFileSync(
      "jq",
      [
        "-r",
        "--arg",
        "branch",
        "develop",
        "--arg",
        "commit",
        commit,
        "--arg",
        "runs",
        runs,
        "-f",
        join(HERE, file),
      ],
      { encoding: "utf8", input: JSON.stringify(input) },
    ).trim();

  const artefact = (workflowRun: Record<string, unknown>) => ({
    name: "nestjs-http-suite-default",
    expired: false,
    created_at: "2026-11-05T10:00:00Z",
    workflow_run: {
      id: 7,
      head_branch: "develop",
      repository_id: 1,
      head_repository_id: 1,
      ...workflowRun,
    },
  });

  it("keeps an artefact of a develop run of this repository", () => {
    expect(filter("suite-artefacts.jq", { artifacts: [artefact({})] })).toBe(
      "nestjs-http-suite-default 7 2026-11-05T10:00:00Z",
    );
  });

  it("drops an artefact of a fork's develop branch, another branch or another name", () => {
    const dropped = [
      artefact({ head_repository_id: 2 }),
      artefact({ head_branch: "feat/x" }),
      { ...artefact({}), name: "nestjs-build" },
      { ...artefact({}), expired: true },
    ];

    expect(filter("suite-artefacts.jq", { artifacts: dropped })).toBe("");
  });

  it("reads a cited job's conclusion, by name or by a matrix name's start, skipped rows aside", () => {
    const jobs = (...rows: [string, string][]) => ({
      jobs: rows.map(([name, conclusion]) => ({ name, conclusion })),
    });
    const conclusion = (input: unknown, name: string, mode: string) =>
      execFileSync(
        "jq",
        ["-r", "--arg", "name", name, "--arg", "mode", mode, "-f", join(HERE, "ci-job.jq")],
        { encoding: "utf8", input: JSON.stringify(input) },
      ).trim();
    const matrix = jobs(
      ["smoke (linux)", "success"],
      ["smoke (mac)", "failure"],
      ["other", "success"],
    );

    expect(conclusion(matrix, "smoke (", "prefix")).toBe("failure");
    expect(
      conclusion(
        jobs(["smoke (linux)", "success"], ["smoke (mac)", "skipped"]),
        "smoke (",
        "prefix",
      ),
    ).toBe("success");
    expect(conclusion(matrix, "other", "exact")).toBe("success");
    expect(conclusion(jobs(["other", "skipped"]), "other", "exact")).toBe("");
  });

  const run = (changes: Record<string, unknown>) => ({
    conclusion: "success",
    event: "push",
    head_branch: "develop",
    head_sha: "abc123",
    head_repository: { id: 1 },
    repository: { id: 1 },
    ...changes,
  });

  it("keeps only the runs of the asked commit", () => {
    expect(filter("suite-run.jq", run({}), "abc123")).toBe("abc123");
    expect(filter("suite-run.jq", run({}), "def456")).toBe("");
  });

  it("with the runs the release started, trusts those manual runs only", () => {
    const manual = run({ event: "workflow_dispatch", id: 5 });
    const workflowRuns = (...runs: Record<string, unknown>[]) => ({
      workflow_runs: runs.map((r) => ({ ...r, status: "completed" })),
    });

    expect(filter("suite-run.jq", manual, "abc123", "4 5")).toBe("abc123");
    expect(filter("suite-run.jq", manual, "abc123", "4 55")).toBe("");
    expect(filter("suite-run.jq", manual, "abc123")).toBe("");
    expect(filter("suite-run.jq", run({ id: 5 }), "abc123", "5")).toBe("");
    expect(filter("ci-runs.jq", workflowRuns(manual, run({ id: 6 })), "abc123", "5")).toBe(
      "5 abc123",
    );
    expect(filter("ci-runs.jq", workflowRuns(manual), "abc123")).toBe("");
  });

  it("trusts a successful push or schedule run of this repository and names its commit", () => {
    expect(filter("suite-run.jq", run({}))).toBe("abc123");
    expect(filter("suite-run.jq", run({ event: "schedule" }))).toBe("abc123");
  });

  it("trusts no pull request run, fork run, other branch or unsuccessful run", () => {
    const untrusted = [
      run({ event: "pull_request" }),
      run({ event: "workflow_dispatch" }),
      run({ head_repository: { id: 2 } }),
      run({ head_branch: "feat/x" }),
      run({ conclusion: "failure" }),
      run({ conclusion: null }),
    ];

    for (const candidate of untrusted) expect(filter("suite-run.jq", candidate)).toBe("");
  });
});

describe("checklist release scope", () => {
  const noTest = (id: string, target: string) =>
    `${CHECKLIST}: ${id}: release gate: no test for target ${target}`;
  const passed = { outcome: "passed", cases: ["a"] };

  /** Writes each report under its artefact directory, as the fetcher lays them out, and returns the directory. */
  function artefacts(reports: Record<string, { target: string; checks: Record<string, unknown> }>) {
    const directory = mkdtempSync(join(tmpdir(), "checklist-scope-"));

    for (const [artefact, report] of Object.entries(reports)) {
      mkdirSync(join(directory, artefact));
      writeFileSync(
        join(directory, artefact, "http-suite-default.json"),
        JSON.stringify({ format: "seampact-http-suite-report/1", profile: "default", ...report }),
      );
    }

    return directory;
  }

  function gateOver(directory: string, options: Partial<CheckOptions>, root = fx("release-gate")) {
    try {
      return lines(check({ root, releaseGate: true, suiteReports: directory, ...options }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("a target-scoped check counts only for its targets", () => {
    const directory = mkdtempSync(join(tmpdir(), "checklist-scope-"));
    const bodyLimit = parseSuiteCase(
      JSON.parse(
        readFileSync(join(REPO, "packages/tools/http-suite/cases/batch-body-limit.json"), "utf8"),
      ),
      "batch-body-limit",
    );

    for (const target of SERVER_TARGETS.filter((t) => !TARGETS_AFTER_1_0.includes(t))) {
      const result: CaseResult = {
        ...caseHeader(bodyLimit, target),
        outcome: "passed",
        failures: [],
      };

      mkdirSync(join(directory, target));

      for (const profile of ["default", "boot"] as const) {
        writeFileSync(
          join(directory, target, `http-suite-${profile}.json`),
          JSON.stringify(suiteReportOf({ target, profile }, [result])),
        );
      }
    }

    const out = gateOver(
      directory,
      { itemsAfter1_0: ITEMS_AFTER_1_0, variantRowSets: VARIANT_ROW_SETS },
      REPO,
    );

    expect(out.filter((line) => line.includes("does not list"))).toEqual([]);
    expect(out).not.toContain(noTest("CHK-067", "fastify"));
    expect(out).not.toContain(noTest("CHK-083", "laravel"));
    expect(out).not.toContain(noTest("CHK-084", "symfony"));
    expect(out).not.toContain(noTest("CHK-186", "ninja"));
  });

  it("a variant set passes only with every row passed", () => {
    const variantRowSets = new Map([
      [
        "CHK-002",
        {
          target: "nestjs",
          rows: [
            { name: "row a", artefactPrefix: "nestjs-http-suite-a-" },
            { name: "row b", artefactPrefix: "nestjs-http-suite-b-" },
          ],
        },
      ],
    ]);
    const rowA = { target: "nestjs", checks: { "CHK-002": passed } };
    const oneRow = gateOver(artefacts({ "nestjs-http-suite-a-x": rowA }), { variantRowSets });
    const everyRow = gateOver(
      artefacts({ "nestjs-http-suite-a-x": rowA, "nestjs-http-suite-b-y": rowA }),
      { variantRowSets },
    );

    expect(oneRow).toContain(
      `${noTest("CHK-002", "nestjs")} (no passed suite report from the variant rows: row b)`,
    );
    expect(everyRow).not.toContainEqual(expect.stringContaining(noTest("CHK-002", "nestjs")));
  });

  it("a deferred pair is not required", () => {
    const itemsAfter1_0 = new Map([
      ["CHK-001", { targets: ["nestjs"], reason: "after" }],
      ["CHK-002", { reason: "after" }],
    ]);
    const out = gateOver(artefacts({ other: { target: "hono", checks: {} } }), { itemsAfter1_0 });

    expect(out).toEqual([]);
  });

  it("an id listed twice in the after-1.0 list is refused by name", () => {
    const entry = { reason: "after" };

    expect(() =>
      indexItemsAfter1_0([
        ["CHK-001", entry],
        ["CHK-001", entry],
      ]),
    ).toThrow("CHK-001 twice");
  });

  it("a proven deferred id fails by name", () => {
    const itemsAfter1_0 = new Map([["CHK-001", { targets: ["nestjs"], reason: "after" }]]);
    const out = gateOver(
      artefacts({ nestjs: { target: "nestjs", checks: { "CHK-001": passed } } }),
      {
        itemsAfter1_0,
      },
    );

    expect(out).toContain(
      "scripts/checklist/release-scope.ts: CHK-001: proven for target nestjs: drop it from the after-1.0 list",
    );
  });

  describe("a whole-suite id with refused cases", () => {
    const target = "fastify";
    const caseOf = (id: string) =>
      parseSuiteCase(
        JSON.parse(readFileSync(join(REPO, `packages/tools/http-suite/cases/${id}.json`), "utf8")),
        id,
      );
    const passedCase = (id: string, checks: string[]): CaseResult => ({
      id,
      title: id,
      checks,
      outcome: "passed",
      failures: [],
    });

    /** The gate over the repository with one hand-written run of fastify (CHK-098 covers every case) of [cases]. */
    function handWrittenRun(cases: CaseResult[]): string[] {
      const directory = mkdtempSync(join(tmpdir(), "checklist-whole-suite-"));

      mkdirSync(join(directory, target));
      writeFileSync(
        join(directory, target, "http-suite-hand-written.json"),
        JSON.stringify(suiteReportOf({ target, profile: "hand-written" }, cases)),
      );

      return gateOver(directory, { itemsAfter1_0: ITEMS_AFTER_1_0 }, REPO);
    }

    it("passes when each refused case cites only ids deferred for the target", () => {
      const absoluteUrls = caseOf("absolute-urls-from-public-origin");
      const out = handWrittenRun([
        passedCase("plain-case", ["CHK-130"]),
        refusedResult(absoluteUrls, "the Node servers refuse this form, after 1.0", target),
      ]);

      expect(out).not.toContainEqual(expect.stringContaining(noTest("CHK-098", target)));
      // The refused case cites CHK-130 itself, so its passed sibling does not prove the deferred pair.
      expect(out).not.toContainEqual(
        expect.stringContaining(`CHK-130: proven for target ${target}`),
      );
    });

    it("passes when a refused case does not apply to the target", () => {
      const mountMismatch = caseOf("mount-mismatch-refused-at-first-request");
      const reason = outsideTargetsReason(mountMismatch, target);

      expect(reason).toBeDefined();

      const out = handWrittenRun([
        passedCase("plain-case", []),
        refusedResult(mountMismatch, reason ?? "", target),
      ]);

      expect(out).not.toContainEqual(expect.stringContaining(noTest("CHK-098", target)));
    });

    it("stays refused when a refused case cites an id the release scope does not defer", () => {
      const out = handWrittenRun([
        passedCase("plain-case", []),
        refusedResult(
          caseOf("mount-mismatch-fails-boot"),
          "the sample app does not serve it",
          target,
        ),
      ]);

      expect(out).toContain(`${noTest("CHK-098", target)} (its suite run refused the id)`);
    });
  });

  it("an expected consumer without a report fails", () => {
    const suiteConsumers = new Map([
      ["nestjs", "p5-nestjs.yml"],
      ["laravel", "p6-laravel.yml"],
    ]);
    const out = gateOver(
      artefacts({ nestjs: { target: "nestjs", checks: { "CHK-001": passed } } }),
      { suiteConsumers },
    );

    expect(out).toContain(
      "scripts/checklist/suite-consumers.ts: -: release gate: no http-suite report for target laravel (from a successful p6-laravel.yml run)",
    );
    expect(out).not.toContainEqual(expect.stringContaining("report for target nestjs"));
  });

  it("a variant's report or an empty report is not the consumer's report", () => {
    const suiteConsumers = new Map([
      ["express", "p5-fastify-express.yml"],
      ["nestjs", "p5-nestjs.yml"],
    ]);
    const out = gateOver(
      artefacts({
        "express-http-suite-express4": { target: "express4", checks: { "CHK-001": passed } },
        "nestjs-http-suite-empty": { target: "nestjs", checks: {} },
      }),
      { suiteConsumers },
    );
    const missing = (target: string, workflow: string) =>
      `scripts/checklist/suite-consumers.ts: -: release gate: no http-suite report for target ${target} (from a successful ${workflow} run)`;

    expect(out).toContain(missing("express", "p5-fastify-express.yml"));
    expect(out).toContain(missing("nestjs", "p5-nestjs.yml"));
  });

  it("the repository names a consumer workflow for every server the gate requires", () => {
    expect(suiteConsumerProblems(REPO, SUITE_CONSUMERS)).toEqual([]);
    expect([...SUITE_CONSUMERS.keys()].sort()).toEqual(
      SERVER_TARGETS.filter((t) => !TARGETS_AFTER_1_0.includes(t)).sort(),
    );
  });

  it("refuses a consumer table with a missing workflow, a missing server or a deferred one", () => {
    const suiteConsumers = new Map([...SUITE_CONSUMERS, ["api-platform", "p6-symfony.yml"]]);

    suiteConsumers.delete("drf");
    suiteConsumers.set("ninja", "p7-gone.yml");

    expect(lines(suiteConsumerProblems(REPO, suiteConsumers))).toEqual([
      "scripts/checklist/suite-consumers.ts: -: server target drf has no consumer workflow: name the one that runs its http suite",
      "scripts/checklist/suite-consumers.ts: -: consumer workflow of ninja does not exist: p7-gone.yml",
      "scripts/checklist/suite-consumers.ts: -: consumer workflow for api-platform, not a server target the release gate requires",
    ]);
  });

  describe("a deferral for a form generation refuses by name", () => {
    /** The release-gate fixture with a proof file whose CHK-001 entry lists [refusals]. */
    function rootRefusing(refusals: string[]): string {
      const root = mkdtempSync(join(tmpdir(), "checklist-refusal-"));

      cpSync(fx("release-gate"), root, { recursive: true });
      writeFileSync(
        join(root, "docs/conformance/proofs/refused.yaml"),
        `lane: refused\nproofs:\n  - id: CHK-001\n    refusals:\n${refusals.map((r) => `      - '${r}'`).join("\n")}\n`,
      );

      return root;
    }

    const refusedOnNestjs = new Map([
      ["CHK-001", { targets: ["nestjs"], refusedOn: ["nestjs"], reason: "refused" }],
    ]);

    it("accepts it once a proof file tests the refusal on the target", () => {
      const root = rootRefusing(["nestjs: src/a.test.txt#refused by name"]);

      expect(lines(check({ root, itemsAfter1_0: refusedOnNestjs }))).toEqual([]);
    });

    it("refuses it when no proof file tests the refusal", () => {
      expect(lines(check({ root: fx("release-gate"), itemsAfter1_0: refusedOnNestjs }))).toEqual([
        "scripts/checklist/release-scope.ts: CHK-001: refused on target nestjs with no refusal test in a proof file",
      ]);
    });

    it("refuses a refusal on a target the entry does not defer", () => {
      const itemsAfter1_0 = new Map([
        ["CHK-001", { targets: ["nestjs"], refusedOn: ["core"], reason: "refused" }],
      ]);

      expect(lines(check({ root: fx("release-gate"), itemsAfter1_0 }))).toEqual([
        "scripts/checklist/release-scope.ts: CHK-001: after-1.0 entry names a refusal on a target it does not defer: core",
      ]);
    });

    it("does not count a refusal test as the proof of the item", () => {
      const root = rootRefusing(["nestjs: src/a.test.txt#refused by name"]);
      const out = lines(check({ root, releaseGate: true }));

      expect(out).toContain(`${CHECKLIST}: CHK-001: release gate: no test for target nestjs`);
    });
  });

  it("refuses an after-1.0 entry of an unknown id, an unlisted target or without a reason", () => {
    const itemsAfter1_0 = new Map([
      ["CHK-009", { reason: "after" }],
      ["CHK-001", { targets: ["express"], reason: " " }],
    ]);
    const out = lines(check({ root: fx("release-gate"), itemsAfter1_0 }));

    expect(out).toEqual([
      "scripts/checklist/release-scope.ts: CHK-009: after-1.0 list names an unknown id (not in the checklist)",
      "scripts/checklist/release-scope.ts: CHK-001: after-1.0 entry without a reason",
      "scripts/checklist/release-scope.ts: CHK-001: after-1.0 entry names a target the item does not list: express",
    ]);
  });
});

describe("checklist ci references", () => {
  const noTest = (id: string, target: string) =>
    `${CHECKLIST}: ${id}: release gate: no test for target ${target}`;

  /** The release-gate fixture with a proof citing [ref] for CHK-002 on nestjs and a workflow holding job `build`. */
  function rootCiting(ref: string): string {
    const root = mkdtempSync(join(tmpdir(), "checklist-ci-"));

    cpSync(fx("release-gate"), root, { recursive: true });
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, ".github/workflows/w.yml"), "jobs:\n  build:\n    name: build\n");
    writeFileSync(
      join(root, "docs/conformance/proofs/lane-ci.yaml"),
      `lane: lane-ci\nproofs:\n  - id: CHK-002\n    tests: ['nestjs: ci: ${ref}']\n`,
    );

    return root;
  }

  const COMMIT = "a".repeat(40);
  const EXPRESSION_NAME = ["$", "{{ matrix.row }}"].join("");

  function gateWithCiJobs(
    jobs: unknown[] | undefined,
    otherReports: Record<string, unknown> = {},
  ): string[] {
    const root = rootCiting("w.yml#build");
    const reports = mkdtempSync(join(tmpdir(), "checklist-ci-reports-"));

    try {
      writeFileSync(
        join(reports, "http-suite-default.json"),
        JSON.stringify({
          format: "seampact-http-suite-report/1",
          target: "hono",
          profile: "default",
          checks: {},
        }),
      );

      for (const [name, report] of Object.entries(otherReports))
        writeFileSync(join(reports, `http-suite-${name}.json`), JSON.stringify(report));

      if (jobs !== undefined)
        writeFileSync(
          join(reports, "ci-jobs.json"),
          JSON.stringify({ format: "seampact-ci-jobs/1", jobs }),
        );

      return lines(check({ root, releaseGate: true, suiteReports: reports }));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(reports, { recursive: true, force: true });
    }
  }

  it("refuses a ci reference to a missing workflow or job", () => {
    for (const [ref, message] of [
      ["gone.yml#build", "CI workflow does not exist: gone.yml"],
      ["w.yml#deploy", "CI job does not exist: deploy in w.yml"],
    ] as const) {
      const root = rootCiting(ref);

      try {
        expect(lines(check({ root }))).toEqual([
          `docs/conformance/proofs/lane-ci.yaml: CHK-002: ${message}`,
        ]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("counts a ci reference only when its newest develop run passed, and names a failed one", () => {
    const job = (conclusion: string) => ({
      ref: "w.yml#build",
      conclusion,
      run: 9,
      commit: COMMIT,
    });

    expect(gateWithCiJobs([job("success")])).not.toContain(noTest("CHK-002", "nestjs"));
    expect(gateWithCiJobs([job("failure")])).toContain(
      `${CHECKLIST}: CHK-002: release gate: CI job "w.yml#build" for target nestjs concluded "failure" (run 9 at "${COMMIT}")`,
    );
    expect(gateWithCiJobs(undefined)).toContain(
      `${noTest("CHK-002", "nestjs")} (no develop run recorded for the CI job w.yml#build)`,
    );
  });

  it("names a failed ci job even when a suite report passes the pair", () => {
    const nestjsPasses = {
      format: "seampact-http-suite-report/1",
      target: "nestjs",
      profile: "default",
      checks: { "CHK-002": { outcome: "passed", cases: ["a"] } },
    };
    const failed = { ref: "w.yml#build", conclusion: "failure", run: 9, commit: COMMIT };

    expect(gateWithCiJobs([failed], { nestjs: nestjsPasses })).toContain(
      `${CHECKLIST}: CHK-002: release gate: CI job "w.yml#build" for target nestjs concluded "failure" (run 9 at "${COMMIT}")`,
    );
  });

  it("refuses a malformed or hostile ci job result and never prints it raw", () => {
    const hostile = "abc\n::error::injected";
    const good = { ref: "w.yml#build", conclusion: "success", run: 9, commit: COMMIT };
    const out = gateWithCiJobs([
      { ...good, commit: hostile },
      { ...good, conclusion: hostile },
      { ...good, ref: hostile },
    ]);

    expect(out.filter((line) => line.includes("malformed CI job result"))).toHaveLength(3);
    expect(out.join("\n")).not.toContain("\n::error::");
    expect(out.some((line) => line.startsWith("::"))).toBe(false);
    expect(gateWithCiJobs([good])).not.toContain(noTest("CHK-002", "nestjs"));
  });

  it("names an unnamed matrix job by its id and its rows' matrix values", () => {
    const root = rootCiting("w.yml#build");

    try {
      writeFileSync(
        join(root, ".github/workflows/w.yml"),
        ["jobs:", "  build:", "    strategy:", "      matrix:", "        jdk: [21, 25]", ""].join(
          "\n",
        ),
      );

      expect(lines(check({ root }))).toEqual([]);
      expect(
        execFileSync("node", [join(HERE, "cli.ts"), "ci-jobs", "--root", root], {
          encoding: "utf8",
        }),
      ).toBe("w.yml\tbuild\tbuild (\tprefix\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gate-workflows refuses a cited workflow the release cannot start and names its release-gate input", () => {
    const root = rootCiting("w.yml#build");
    const gateWorkflows = () =>
      spawnSync("node", [join(HERE, "cli.ts"), "gate-workflows", "--root", root], {
        encoding: "utf8",
      });

    try {
      const refused = gateWorkflows();

      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain(
        "w.yml: the release cannot start it at its commit: add a workflow_dispatch trigger",
      );

      writeFileSync(
        join(root, ".github/workflows/w.yml"),
        "on:\n  workflow_dispatch:\njobs:\n  build:\n    name: build\n",
      );
      expect(gateWorkflows().stdout).toBe("w.yml\n");

      writeFileSync(
        join(root, ".github/workflows/w.yml"),
        "on:\n  workflow_dispatch:\n    inputs:\n      release-gate:\n        type: boolean\njobs:\n  build:\n    name: build\n",
      );
      expect(gateWorkflows().stdout).toBe("w.yml\trelease-gate\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a ci job whose name starts with an expression", () => {
    const root = rootCiting("w.yml#build");

    try {
      writeFileSync(
        join(root, ".github/workflows/w.yml"),
        ["jobs:", "  build:", `    name: ${EXPRESSION_NAME}`, ""].join("\n"),
      );
      expect(lines(check({ root }))).toEqual([
        "docs/conformance/proofs/lane-ci.yaml: CHK-002: CI job name starts with an expression: build in w.yml (it would match every job of a run)",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    const ref = {
      raw: "",
      kind: "test",
      target: "core",
      path: "src/a.test.ts",
      name: "works",
    } as const;
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

  it("gate-workflows names every consumer workflow and every workflow a proof cites", () => {
    const lines = run("gate-workflows").trim().split("\n");
    const workflows = lines.map((line) => line.split("\t")[0]);

    for (const workflow of SUITE_CONSUMERS.values()) expect(workflows).toContain(workflow);
    expect(workflows).toContain("p6-jvm-core.yml");
    expect(workflows).toEqual([...new Set(workflows)].sort());
    expect(lines).toContain("p5-adonis.yml\trelease-gate");
    expect(lines).toContain("p6-jvm-core.yml");
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
