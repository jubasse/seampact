// The http-suite reports of the consumer runs (ADR 0015 "Report"), read as proofs for the release gate: each report
// names its server target and the outcome of every checklist id its cases prove.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CaseOutcome, SuiteReport } from "../../packages/tools/http-suite/src/suite-report.ts";
import type { Problem } from "./model.ts";
import { shown } from "./shown.ts";
import { reportTargetOf, SERVER_TARGETS, TARGET_VARIANTS } from "./targets.ts";

// Typed from the http-suite's own format, so a format change there fails the typecheck here.
const SUITE_REPORT_FORMAT: SuiteReport["format"] = "seampact-http-suite-report/1";
const CASE_OUTCOMES: readonly CaseOutcome[] = ["passed", "failed", "refused"];
const CHECK_ID = /^CHK-\d{3,}$/;
const REPORT_FILE = /^http-suite-.+\.json$/;

/** One checklist id's outcome in one suite report. */
export interface SuiteProof {
  /** The report file, as the reports directory argument joined with its path under it. */
  file: string;
  /** The artefact the report came in: the first directory of its path under the reports directory, if any. */
  artefact?: string;
  target: string;
  id: string;
  outcome: CaseOutcome;
}

/**
 * The proofs of every report under a directory, and the server targets that have a report of their own: a valid
 * report that names the target itself, not one of its variants, and holds at least one check.
 */
export interface SuiteReports {
  proofs: SuiteProof[];
  targets: ReadonlySet<string>;
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isCaseOutcome = (v: unknown): v is CaseOutcome => CASE_OUTCOMES.some((known) => known === v);
const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((item) => typeof item === "string");

/**
 * Every `http-suite-*.json` file under `directory`, at any depth, must be an http-suite report of a server target;
 * other files (logs, generated sources, other JSON an artefact also holds) are out of scope. A directory without any
 * report is a problem.
 */
export function loadSuiteReports(directory: string, problems: Problem[]): SuiteReports {
  const files = reportFilesUnder(directory);
  const targets = new Set<string>();

  if (files.length === 0) {
    problems.push({
      file: directory,
      message: "no http-suite report (http-suite-*.json) under the directory",
    });

    return { proofs: [], targets };
  }

  const proofs = files.flatMap((file) => {
    const report = validReportOf(file, readReport(file, problems), problems);

    if (report === undefined) return [];

    if (report.reportTarget === report.target && Object.keys(report.checks).length > 0)
      targets.add(report.target);

    return suiteProofsOf(file, report, problems).map((proof) => withArtefact(proof, directory));
  });

  return { proofs, targets };
}

function withArtefact(proof: SuiteProof, directory: string): SuiteProof {
  const [artefact, ...rest] = relative(directory, proof.file).split(sep);

  return artefact !== undefined && rest.length > 0 ? { ...proof, artefact } : proof;
}

function reportFilesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && REPORT_FILE.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((left, right) => relative(directory, left).localeCompare(relative(directory, right)));
}

function readReport(file: string, problems: Problem[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    problems.push({ file, message: `not valid JSON: ${shown(reason)}` });

    return undefined;
  }
}

/** A report's server target and its `checks`, when the file is an http-suite report of a server target. */
interface ValidReport {
  /** The target the report names, a variant such as `express4` included. */
  reportTarget: string;
  /** The server target it proves, a variant mapped to its target. */
  target: string;
  checks: Rec;
}

function validReportOf(
  file: string,
  report: unknown,
  problems: Problem[],
): ValidReport | undefined {
  if (report === undefined) return undefined;

  if (!isRec(report) || report.format !== SUITE_REPORT_FORMAT) {
    problems.push({
      file,
      message: `not an http-suite report (expected format ${SUITE_REPORT_FORMAT})`,
    });

    return undefined;
  }

  const reportTarget = report.target;
  const target = typeof reportTarget === "string" ? reportTargetOf(reportTarget) : undefined;

  if (typeof reportTarget !== "string" || target === undefined) {
    problems.push({
      file,
      message: `suite report of an unknown server target ${shown(reportTarget)} (expected one of ${[...SERVER_TARGETS, ...TARGET_VARIANTS.keys()].join(", ")})`,
    });

    return undefined;
  }

  if (!isRec(report.checks)) {
    problems.push({
      file,
      message: "malformed suite report: `checks` must map checklist ids to results",
    });

    return undefined;
  }

  return { reportTarget, target, checks: report.checks };
}

function suiteProofsOf(file: string, report: ValidReport, problems: Problem[]): SuiteProof[] {
  const proofs: SuiteProof[] = [];

  for (const [id, result] of Object.entries(report.checks)) {
    const outcome = checkOutcomeOf(result);

    if (!CHECK_ID.test(id) || outcome === undefined) {
      problems.push({
        file,
        id: CHECK_ID.test(id) ? id : shown(id),
        message:
          "malformed suite report entry: needs a CHK id, an outcome and the case ids (at least one when passed)",
      });
      continue;
    }

    proofs.push({ file, target: report.target, id, outcome });
  }

  return proofs;
}

/** The outcome of a `checks` entry, or undefined when its shape is not the http-suite's `CheckResult`. */
function checkOutcomeOf(result: unknown): CaseOutcome | undefined {
  if (!isRec(result) || !isCaseOutcome(result.outcome) || !isStringList(result.cases))
    return undefined;

  if (result.outcome === "passed" && result.cases.length === 0) return undefined;

  return result.outcome;
}
