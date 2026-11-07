import { join } from "node:path";
import { expect, test } from "vitest";
import { caseProblems, reportFileOf } from "./profile-run.js";
import type { SuiteCase } from "./suite-case.js";
import { suiteReportOf } from "./suite-report.js";

const report = suiteReportOf({ target: "express", profile: "default" }, [
  { id: "refused-case", title: "t", checks: [], outcome: "refused", failures: [] },
  { id: "passed-case", title: "t", checks: [], outcome: "passed", failures: [] },
]);

test("a case passes when its outcome is the one its refusal says", () => {
  expect(caseProblems(report, "refused-case", { "refused-case": "a reason" })).toEqual([]);
  expect(caseProblems(report, "passed-case", {})).toEqual([]);
});

test("a refused case without a refusal, or a missing case, is a problem", () => {
  expect(caseProblems(report, "refused-case", {})).toEqual([
    "the case 'refused-case' is refused, expected passed",
  ]);
  expect(caseProblems(report, "absent", {})).toEqual([
    "the report holds no result for the case 'absent'",
  ]);
});

test("a case scoped to other targets is expected refused, and passed on its own targets", () => {
  const scopedCase = (targets: string[]): SuiteCase => ({
    id: "refused-case",
    title: "t",
    checks: [],
    profiles: ["default"],
    targets,
    steps: [],
  });

  expect(caseProblems(report, "refused-case", {}, scopedCase(["adonis"]))).toEqual([]);
  expect(caseProblems(report, "refused-case", {}, scopedCase(["express"]))).toEqual([
    "the case 'refused-case' is refused, expected passed",
  ]);
});

test("a pack profile's report file name holds no colon, which CI artifact uploads refuse", () => {
  expect(reportFileOf("reports", "pack:spring")).toBe(
    join("reports", "http-suite-pack-spring.json"),
  );
  expect(reportFileOf("reports", "default")).toBe(join("reports", "http-suite-default.json"));
});
