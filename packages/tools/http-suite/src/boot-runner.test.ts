import { describe, expect, test } from "vitest";
import { runBootSuite } from "./boot-runner.js";
import { BOOT_STARTED_LINE, BOOT_VARIANT_ENV } from "./boot-variant.js";
import { parseSuiteCase, type SuiteCase } from "./suite-case.js";

// A sample app double: the allow-listed variant starts, `missing-handler` never ends, every other variant refuses.
const SAMPLE_APP = `
const variant = process.env.${BOOT_VARIANT_ENV};
if (variant === "allow-listed-framework-route") console.log(${JSON.stringify(BOOT_STARTED_LINE)});
else if (variant === "missing-handler") setInterval(() => {}, 1000);
else { console.error("seampact: the api 'tasks' cannot start: no decider for 'roles'"); process.exit(1); }
`;
const BOOT_TIMEOUT_MS = 500;

function bootCase(id: string, boot: Record<string, unknown>): SuiteCase {
  return parseSuiteCase({ id, title: id, checks: ["CHK-062"], profiles: ["boot"], boot }, id);
}

function run(cases: SuiteCase[], refusals?: Record<string, string>) {
  return runBootSuite({
    target: "double",
    cases,
    ...(refusals === undefined ? {} : { refusals }),
    command: process.execPath,
    args: ["-e", SAMPLE_APP],
    cwd: process.cwd(),
    bootTimeoutMs: BOOT_TIMEOUT_MS,
  });
}

describe("runBootSuite", () => {
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

  test("stops an app that neither starts nor exits", async () => {
    const report = await run([
      bootCase("hangs", { variant: "missing-handler", outcome: "refuses", diagnostic: ["x"] }),
    ]);

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
