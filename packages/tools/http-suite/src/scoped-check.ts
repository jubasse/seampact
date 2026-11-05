// A checklist id that a case or a whole profile proves, for every target or only for the targets it names.
import { baseTargetOf } from "./target-variant.js";

/** Without `targets`, the id counts in the report of every target; with them, only in theirs. */
export interface ScopedCheck {
  readonly id: string;
  readonly targets?: readonly string[];
}

/** The ids of [checks] that count in a report of [reportTarget], a target variant counting as its target. */
export function checkIdsForTarget(checks: readonly ScopedCheck[], reportTarget: string): string[] {
  const target = baseTargetOf(reportTarget);

  return checks
    .filter((check) => check.targets === undefined || check.targets.includes(target))
    .map((check) => check.id);
}
