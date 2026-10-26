import { describe, expect, test } from "vitest";
import { runBootSuite } from "./boot-runner.js";
import { BOOT_STARTED_LINE, BOOT_VARIANT_ENV } from "./boot-variant.js";
import { parseSuiteCase, type SuiteCase } from "./suite-case.js";

// A sample app double: the allow-listed variant starts, `missing-handler` never ends, `missing-scope-resolver` refuses
// with its message wrapped as a console wraps it at 80 columns, every other variant refuses.
const SAMPLE_APP = `
const variant = process.env.${BOOT_VARIANT_ENV};
if (variant === "allow-listed-framework-route") console.log(${JSON.stringify(BOOT_STARTED_LINE)});
else if (variant === "missing-handler") setInterval(() => {}, 1000);
else if (variant === "missing-scope-resolver") { console.error("  seampact: the api 'tasks' cannot\\n  start: no scope resolver for the scope 'chan  \\n  nel'  "); process.exit(1); }
else { console.error("seampact: the api 'tasks' cannot start: no decider for 'roles'"); process.exit(1); }
`;
// A started process gets room to start on a busy machine; only the hanging app needs a short wait.
const START_TIMEOUT_MS = 20_000;
// Slow on a loaded machine: give it more than the default limit.
const TEST_TIMEOUT_MS = 60_000;
const HANG_TIMEOUT_MS = 500;

function bootCase(id: string, boot: Record<string, unknown>): SuiteCase {
  return parseSuiteCase({ id, title: id, checks: ["CHK-062"], profiles: ["boot"], boot }, id);
}

function run(
  cases: SuiteCase[],
  refusals?: Record<string, string>,
  bootTimeoutMs = START_TIMEOUT_MS,
) {
  return runBootSuite({
    target: "double",
    cases,
    ...(refusals === undefined ? {} : { refusals }),
    command: process.execPath,
    args: ["-e", SAMPLE_APP],
    cwd: process.cwd(),
    bootTimeoutMs,
  });
}

describe("runBootSuite", { timeout: TEST_TIMEOUT_MS }, () => {
  test("passes a refusal with its diagnostic and a start, and refuses by name", async () => {
    const report = await run(
      [
        bootCase("refused", {
          variant: "missing-decider",
          outcome: "refuses",
          diagnostic: ["cannot start", "no decider for 'roles'"],
        }),
        bootCase("started", { variant: "allow-listed-framework-route", outcome: "starts" }),
        bootCase("not-run", {
          variant: "unlisted-framework-route",
          outcome: "refuses",
          diagnostic: ["x"],
        }),
      ],
      { "not-run": "no framework-route check yet" },
    );

    expect(report).toMatchObject({ target: "double", profile: "boot" });
    expect(report.summary).toEqual({ passed: 2, failed: 0, refused: 1 });
    expect(report.checks["CHK-062"]).toEqual({
      outcome: "refused",
      cases: ["refused", "started", "not-run"],
    });
  });

  test("fails a refusal without the diagnostic, a start that refuses and a refusal that starts", async () => {
    const report = await run([
      bootCase("wrong-diagnostic", {
        variant: "missing-decider",
        outcome: "refuses",
        diagnostic: ["no scope resolver"],
      }),
      bootCase("refuses-instead", { variant: "missing-decider", outcome: "starts" }),
      bootCase("starts-instead", {
        variant: "allow-listed-framework-route",
        outcome: "refuses",
        diagnostic: ["x"],
      }),
    ]);

    expect(report.cases.map((result) => result.failures)).toEqual([
      [expect.stringContaining('refused without "no scope resolver"')],
      [expect.stringContaining("did not start (exit 1)")],
      [expect.stringContaining("started, expected a refusal")],
    ]);
  });

  test("matches a diagnostic whatever whitespace the console wraps it with", async () => {
    const report = await run([
      bootCase("wrapped", {
        variant: "missing-scope-resolver",
        outcome: "refuses",
        diagnostic: ["the api 'tasks' cannot start", "no scope resolver for the scope 'channel'"],
      }),
    ]);

    expect(report.cases.map((result) => result.failures)).toEqual([[]]);
  });

  test("stops an app that neither starts nor exits", async () => {
    const report = await run(
      [bootCase("hangs", { variant: "missing-handler", outcome: "refuses", diagnostic: ["x"] })],
      undefined,
      HANG_TIMEOUT_MS,
    );

    expect(report.cases[0]?.failures).toEqual([
      expect.stringContaining("neither started nor exited in time"),
    ]);
  });

  test("refuses a case of another profile", async () => {
    const httpCase = parseSuiteCase(
      {
        id: "http",
        title: "http",
        checks: [],
        profiles: ["default"],
        steps: [{ request: { method: "GET", path: "/" }, expect: { status: 200 } }],
      },
      "http",
    );

    await expect(run([httpCase])).rejects.toThrow("do not run in the 'boot' profile");
  });
});
