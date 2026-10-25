// What a consumer's profile run shares across targets: the refusals of the cases a run holds, the report file of a
// profile, and one test per case of a report, registered through the consumer's own test function.
import { join } from "node:path";
import type { SuiteCase, SuiteProfile } from "./suite-case.js";
import type { SuiteReport } from "./suite-report.js";

/** The consumer's test registration, such as vitest's `test`: a name and a body that throws to fail. */
export type DefineCaseTest = (name: string, body: () => void) => unknown;

/** The refusals among [refusals] that name a case of [cases]. */
export function refusalsOf(
  cases: readonly SuiteCase[],
  refusals: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    cases.flatMap((suiteCase) => {
      const reason = refusals[suiteCase.id];

      return reason === undefined ? [] : [[suiteCase.id, reason]];
    }),
  );
}

// The profile's colon (`pack:spring`) becomes a dash: CI artifact uploads refuse a colon in a file name.
const PROFILE_KIND_SEPARATOR = ":";
const FILE_NAME_SEPARATOR = "-";

/** The report file of [profile] in [directory]: `http-suite-pack-spring.json` for `pack:spring`. */
export function reportFileOf(directory: string, profile: SuiteProfile): string {
  const fileProfile = profile.replaceAll(PROFILE_KIND_SEPARATOR, FILE_NAME_SEPARATOR);

  return join(directory, `http-suite-${fileProfile}.json`);
}

/** Each way the case [id] of [report] differs from passing, or from refused when [refusals] names it. */
export function caseProblems(
  report: SuiteReport | undefined,
  id: string,
  refusals: Readonly<Record<string, string>>,
): string[] {
  const result = report?.cases.find((caseResult) => caseResult.id === id);

  if (result === undefined) return [`the report holds no result for the case '${id}'`];

  const expected = Object.hasOwn(refusals, id) ? "refused" : "passed";
  const outcomeProblem =
    result.outcome === expected
      ? []
      : [`the case '${id}' is ${result.outcome}, expected ${expected}`];

  return [...result.failures, ...outcomeProblem];
}

/** One test per case of [cases], each failing with the case's problems in the report [report] gives. */
export function testEachCase(
  cases: readonly SuiteCase[],
  report: () => SuiteReport | undefined,
  refusals: Readonly<Record<string, string>>,
  defineTest: DefineCaseTest,
): void {
  for (const suiteCase of cases) {
    defineTest(`${suiteCase.id}: ${suiteCase.title}`, () => {
      const problems = caseProblems(report(), suiteCase.id, refusals);

      if (problems.length > 0) throw new Error(problems.join("\n"));
    });
  }
}
