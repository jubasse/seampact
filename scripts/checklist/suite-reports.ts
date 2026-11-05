// The http-suite reports of the consumer runs (ADR 0015 "Report"), read as proofs for the release gate: each report
// names its server target and the outcome of every checklist id its cases prove.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { CaseOutcome, SuiteReport } from "../../packages/tools/http-suite/src/suite-report.ts";
import type { Problem } from "./model.ts";
import { SERVER_TARGETS } from "./targets.ts";

// Typed from the http-suite's own format, so a format change there fails the typecheck here.
const SUITE_REPORT_FORMAT: SuiteReport["format"] = "seampact-http-suite-report/1";
const CASE_OUTCOMES: readonly CaseOutcome[] = ["passed", "failed", "refused"];
const CHECK_ID = /^CHK-\d{3,}$/;
const REPORT_EXTENSION = ".json";

/** One checklist id's outcome in one suite report. */
export interface SuiteProof {
  /** The report file, as the reports directory argument joined with its path under it. */
  file: string;
  target: string;
  id: string;
  outcome: CaseOutcome;
}

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isCaseOutcome = (v: unknown): v is CaseOutcome => CASE_OUTCOMES.some((known) => known === v);

/**
 * Every `*.json` file under `directory`, at any depth, must be an http-suite report of a server target; other files
 * (logs, generated sources an artefact also holds) are out of scope. A directory without any report is a problem.
 */
export function loadSuiteReports(directory: string, problems: Problem[]): SuiteProof[] {
  const files = reportFilesUnder(directory);

  if (files.length === 0) {
    problems.push({
      file: directory,
      message: "no http-suite report (*.json) under the directory",
    });

    return [];
  }

  return files.flatMap((file) => suiteProofsOf(file, readReport(file, problems), problems));
}

function reportFilesUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(REPORT_EXTENSION))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((left, right) => relative(directory, left).localeCompare(relative(directory, right)));
}

function readReport(file: string, problems: Problem[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    problems.push({ file, message: `not valid JSON: ${(error as Error).message}` });

    return undefined;
  }
}

function suiteProofsOf(file: string, report: unknown, problems: Problem[]): SuiteProof[] {
  if (report === undefined) return [];

  if (!isRec(report) || report.format !== SUITE_REPORT_FORMAT) {
    problems.push({
      file,
      message: `not an http-suite report (expected format ${SUITE_REPORT_FORMAT})`,
    });

    return [];
  }

  const target = report.target;

  if (typeof target !== "string" || !SERVER_TARGETS.includes(target)) {
    problems.push({
      file,
      message: `suite report of an unknown server target "${String(target)}" (expected one of ${SERVER_TARGETS.join(", ")})`,
    });

    return [];
  }

  if (!isRec(report.checks)) {
    problems.push({
      file,
      message: "malformed suite report: `checks` must map checklist ids to results",
    });

    return [];
  }

  const proofs: SuiteProof[] = [];

  for (const [id, result] of Object.entries(report.checks)) {
    const outcome = isRec(result) ? result.outcome : undefined;

    if (!CHECK_ID.test(id) || !isCaseOutcome(outcome)) {
      problems.push({
        file,
        id,
        message: "malformed suite report entry: needs a CHK id and an outcome",
      });
      continue;
    }

    proofs.push({ file, target, id, outcome });
  }

  return proofs;
}
