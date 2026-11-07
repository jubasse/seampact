import { describe, expect, test } from "vitest";
import { type CaseResult, suiteReportOf } from "./suite-report.js";

const passedCase = (id: string, checks: string[] = []): CaseResult => ({
  id,
  title: id,
  checks,
  outcome: "passed",
  failures: [],
});

describe("suiteReportOf", () => {
  test("a scoped profile check is written only for its targets", () => {
    const cases = [passedCase("missing-handler-fails-boot")];
    const symfony = suiteReportOf({ target: "symfony", profile: "boot" }, cases);
    const laravel = suiteReportOf({ target: "laravel", profile: "boot" }, cases);

    expect(Object.keys(symfony.checks)).toEqual(["CHK-074", "CHK-084"]);
    expect(Object.keys(laravel.checks)).toEqual(["CHK-074", "CHK-083"]);
  });

  test("a target variant counts as its target for a scoped profile check", () => {
    const report = suiteReportOf({ target: "express4", profile: "boot" }, [passedCase("a")]);

    expect(report.checks["CHK-082"]).toEqual({ outcome: "passed", cases: ["a"] });
  });
});
