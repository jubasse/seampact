import { expect, test } from "vitest";
import { caseProblems } from "./profile-run.js";
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
