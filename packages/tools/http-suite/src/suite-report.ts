// The report of one suite run: every case with its outcome, and the outcome of every checklist id the cases prove,
// which the checklist script reads (ADR 0015 "Report").
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { checkIdsForTarget, type ScopedCheck } from "./scoped-check.js";
import type { SuiteProfile } from "./suite-case.js";

export const SUITE_REPORT_FORMAT = "seampact-http-suite-report/1";

/**
 * The checklist ids a whole profile proves rather than one case, so every case of its run counts for the id: the
 * `default` profile proves that the target passes the shared suite (CHK-074) and the facts of the targets named, the
 * `boot` profile the boot tests and the boot refusals, the `hand-written` profile that the target passes the suite
 * with hand-written hooks and no adapter (CHK-098).
 */
export const PROFILE_CHECKS: Readonly<Partial<Record<SuiteProfile, readonly ScopedCheck[]>>> = {
  default: [
    { id: "CHK-070", targets: ["nestjs", "fastify"] },
    { id: "CHK-074" },
    { id: "CHK-079", targets: ["spring-boot"] },
    { id: "CHK-081", targets: ["nestjs"] },
    { id: "CHK-082", targets: ["adonis", "express"] },
    { id: "CHK-084", targets: ["symfony"] },
  ],
  boot: [
    { id: "CHK-074" },
    { id: "CHK-082", targets: ["adonis", "express"] },
    { id: "CHK-083", targets: ["laravel"] },
    { id: "CHK-084", targets: ["symfony"] },
    { id: "CHK-184", targets: ["fastapi"] },
    { id: "CHK-185", targets: ["drf"] },
    { id: "CHK-186", targets: ["ninja"] },
  ],
  "hand-written": [{ id: "CHK-098" }],
};

/** `refused`: the run did not send the case, for the reason the sample app gave by case id. */
export type CaseOutcome = "passed" | "failed" | "refused";

export interface CaseResult {
  readonly id: string;
  readonly title: string;
  readonly checks: readonly string[];
  readonly outcome: CaseOutcome;
  /** Each mismatch, prefixed with the step it was found in; empty when the case passed. */
  readonly failures: readonly string[];
  /** Present when the case was refused. */
  readonly reason?: string;
}

/** A checklist id fails when one of its cases fails, passes when all pass, and is refused otherwise. */
export interface CheckResult {
  readonly outcome: CaseOutcome;
  readonly cases: readonly string[];
}

/** The run a report describes: the server target the sample app was built with, and the profile. */
export interface SuiteRun {
  readonly target: string;
  readonly profile: SuiteProfile;
}

export interface SuiteReport extends SuiteRun {
  readonly format: typeof SUITE_REPORT_FORMAT;
  readonly summary: Readonly<Record<CaseOutcome, number>>;
  readonly cases: readonly CaseResult[];
  readonly checks: Readonly<Record<string, CheckResult>>;
}

export function suiteReportOf(run: SuiteRun, cases: readonly CaseResult[]): SuiteReport {
  return {
    format: SUITE_REPORT_FORMAT,
    target: run.target,
    profile: run.profile,
    summary: {
      passed: countOutcome(cases, "passed"),
      failed: countOutcome(cases, "failed"),
      refused: countOutcome(cases, "refused"),
    },
    cases: cases.map((result) => structuredClone(result)),
    checks: checkResultsOf(run, cases),
  };
}

export function writeSuiteReport(report: SuiteReport, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
}

function countOutcome(cases: readonly CaseResult[], outcome: CaseOutcome): number {
  return cases.filter((result) => result.outcome === outcome).length;
}

function checkResultsOf(run: SuiteRun, cases: readonly CaseResult[]): Record<string, CheckResult> {
  const casesByCheck = new Map<string, CaseResult[]>();

  for (const result of cases) {
    for (const check of result.checks) {
      casesByCheck.set(check, [...(casesByCheck.get(check) ?? []), result]);
    }
  }

  for (const check of checkIdsForTarget(PROFILE_CHECKS[run.profile] ?? [], run.target)) {
    if (cases.length > 0) casesByCheck.set(check, [...cases]);
  }

  return Object.fromEntries(
    [...casesByCheck]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([check, results]) => [
        check,
        { outcome: checkOutcomeOf(results), cases: results.map((result) => result.id) },
      ]),
  );
}

function checkOutcomeOf(results: readonly CaseResult[]): CaseOutcome {
  if (results.some((result) => result.outcome === "failed")) return "failed";

  if (results.every((result) => result.outcome === "passed")) return "passed";

  return "refused";
}
