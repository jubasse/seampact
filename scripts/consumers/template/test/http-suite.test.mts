// Runs the default profile of the shared HTTP suite against the server the overlay starts, writes its report to
// `reports/`, and passes one test per case: passed, or refused by name for a known target bug.
import { loadSuiteCases } from "@seampact/http-suite";
import { expect, test } from "vitest";
import { SUITE_REFUSALS } from "./suite-refusals.mjs";
import { describeHttpProfile, TARGET_PROFILES } from "./suite-run.mjs";

describeHttpProfile("default");

test("every refusal names a case of a profile the target runs", () => {
  const caseIds = new Set(
    TARGET_PROFILES.flatMap((profile) => loadSuiteCases(profile).map((suiteCase) => suiteCase.id)),
  );

  expect(Object.keys(SUITE_REFUSALS).filter((id) => !caseIds.has(id))).toEqual([]);
});
