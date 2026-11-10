// The http-suite reports of the consumer runs (ADR 0015, The shared black-box HTTP suite), read as proofs for the release gate: each report
// names its server target and the outcome of every checklist id its cases prove.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { CaseOutcome, SuiteReport } from "../../packages/tools/http-suite/src/suite-report.ts";
import type { Problem } from "./model.ts";
import { shown } from "./shown.ts";
import { CONCRETE_TARGETS, reportTargetOf, SERVER_TARGETS, TARGET_VARIANTS } from "./targets.ts";

// Typed from the http-suite's own format, so a format change there fails the typecheck here.
const SUITE_REPORT_FORMAT: SuiteReport["format"] = "seampact-http-suite-report/1";
const CASE_OUTCOMES: readonly CaseOutcome[] = ["passed", "failed", "refused"];
const CHECK_ID = /^CHK-\d{3,}$/;
const REPORT_FILE = /^http-suite-.+\.json$/;
// The reason the http-suite gives a case outside the run's target (`outsideTargetsReason`); a test pins the two.
const OUTSIDE_TARGETS_REASON = /^the case applies only to (.+)$/;
const TARGET_LIST_SEPARATOR = ", ";

/** One checklist id's outcome in one suite report. */
export interface SuiteProof {
  /** The report file, as the reports directory argument joined with its path under it. */
  file: string;
  /** The artefact the report came in: the first directory of its path under the reports directory, if any. */
  artefact?: string;
  target: string;
  id: string;
  outcome: CaseOutcome;
  /** On a refused id, when the report lists each of its cases: how many passed and every refused one. */
  refusedIdCases?: RefusedIdCases;
}

/** The cases behind a refused id in one report. */
export interface RefusedIdCases {
  passedCount: number;
  /** Whether a case of the id's entry, or any case of the report citing the id, failed. */
  anyFailed: boolean;
  refused: readonly RefusedCase[];
}

/** A refused case: the checklist ids it cites for the report's target, and whether it applies to that target. */
export interface RefusedCase {
  caseId: string;
  /** The reason the report gives the refusal. */
  reason?: string;
  checks: readonly string[];
  appliesToTarget: boolean;
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
  /** The well-formed entries of the report's `cases`, by case id. */
  cases: ReadonlyMap<string, ReportedCase>;
}

/** One entry of a report's `cases`, as the gate reads it. */
interface ReportedCase {
  caseId: string;
  outcome: CaseOutcome;
  checks: readonly string[];
  reason?: string;
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

  return { reportTarget, target, checks: report.checks, cases: reportedCasesOf(report.cases) };
}

/**
 * The entries of `cases` with an id, an outcome and the ids they cite; others, and any case id listed twice, leave
 * the ids they back refused.
 */
function reportedCasesOf(cases: unknown): Map<string, ReportedCase> {
  const reported = new Map<string, ReportedCase>();
  const duplicated = new Set<string>();

  if (!Array.isArray(cases)) return reported;

  for (const entry of cases) {
    if (!isRec(entry) || typeof entry.id !== "string") continue;

    // A case id listed twice is ambiguous: the ids it backs stay refused.
    if (reported.has(entry.id) || duplicated.has(entry.id)) {
      duplicated.add(entry.id);
      reported.delete(entry.id);
      continue;
    }

    if (!isCaseOutcome(entry.outcome) || !isStringList(entry.checks)) continue;

    const reason = typeof entry.reason === "string" ? { reason: entry.reason } : {};

    reported.set(entry.id, {
      caseId: entry.id,
      outcome: entry.outcome,
      checks: [...entry.checks],
      ...reason,
    });
  }

  return reported;
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

    const refusedIdCases = outcome === "refused" ? refusedIdCasesOf(report, id, result) : undefined;

    proofs.push({
      file,
      target: report.target,
      id,
      outcome,
      ...(refusedIdCases === undefined ? {} : { refusedIdCases }),
    });
  }

  return proofs;
}

/** The cases of a refused id, or undefined when the report does not list one of them. */
function refusedIdCasesOf(
  report: ValidReport,
  id: string,
  result: unknown,
): RefusedIdCases | undefined {
  const caseIds = isRec(result) && isStringList(result.cases) ? result.cases : [];
  const reportedCases = caseIds.map((caseId) => report.cases.get(caseId));

  if (reportedCases.length === 0) return undefined;

  if (!reportedCases.every((reported): reported is ReportedCase => reported !== undefined))
    return undefined;

  const citingTheId = [...report.cases.values()].filter((reported) => reported.checks.includes(id));

  return {
    passedCount: reportedCases.filter((reported) => reported.outcome === "passed").length,
    anyFailed: [...reportedCases, ...citingTheId].some((reported) => reported.outcome === "failed"),
    refused: reportedCases
      .filter((reported) => reported.outcome === "refused")
      .map((reported) => ({
        caseId: reported.caseId,
        ...(reported.reason === undefined ? {} : { reason: reported.reason }),
        checks: reported.checks,
        appliesToTarget: caseAppliesTo(reported, report.target),
      })),
  };
}

/**
 * A refused case applies to [target] unless the http-suite refused it as outside the targets it names: the reason is
 * exactly the http-suite's wording over known target names, and [target] is not among them. Any other reason is the
 * consumer's own refusal.
 */
function caseAppliesTo(reported: ReportedCase, target: string): boolean {
  const outsideTargets = OUTSIDE_TARGETS_REASON.exec(reported.reason ?? "");

  if (outsideTargets?.[1] === undefined) return true;

  const named = outsideTargets[1].split(TARGET_LIST_SEPARATOR);

  if (!named.every((name) => CONCRETE_TARGETS.includes(name))) return true;

  return named.includes(target);
}

/**
 * The outcome a suite report gives an id in the release gate. A refused id passes when the run passed one of its
 * cases and refused each other case only because the case does not apply to the target, or because the run refused it
 * as a declared deferral of the release scope on that target, or because the case cites
 * other ids that [isDeferredPair] leaves for after 1.0 on that target. A refused case citing the id itself is never
 * excused as deferred, and a failed case citing the id (or listed for it) keeps it refused.
 */
export function gateOutcomeOf(
  proof: SuiteProof,
  isDeferredPair: (id: string, target: string) => boolean,
  isDeclaredDeferral: (caseId: string, target: string, reason: string | undefined) => boolean,
): CaseOutcome {
  const cases = proof.refusedIdCases;

  if (
    proof.outcome !== "refused" ||
    cases === undefined ||
    cases.passedCount === 0 ||
    cases.anyFailed
  )
    return proof.outcome;

  const excused = (refusedCase: RefusedCase) =>
    !refusedCase.appliesToTarget ||
    isDeclaredDeferral(refusedCase.caseId, proof.target, refusedCase.reason) ||
    (refusedCase.checks.length > 0 &&
      refusedCase.checks.every((id) => id !== proof.id && isDeferredPair(id, proof.target)));

  return cases.refused.every(excused) ? "passed" : "refused";
}

/** The outcome of a `checks` entry, or undefined when its shape is not the http-suite's `CheckResult`. */
function checkOutcomeOf(result: unknown): CaseOutcome | undefined {
  if (!isRec(result) || !isCaseOutcome(result.outcome) || !isStringList(result.cases))
    return undefined;

  if (result.outcome === "passed" && result.cases.length === 0) return undefined;

  return result.outcome;
}
