import type { FrameworkRouteCheck, Target, TunableBootCheck } from "@seampact/codegen-core";
import type { TargetEntry } from "@seampact/spec/config";
import { type CliProblem, entryWhere } from "../cli-problem.js";
import {
  frameworkRoutesSwitchOf,
  hookCheckSwitchOf,
  isFrameworkRouteCheckOff,
  isFrameworkRouteCheckStrict,
} from "../config/artefact-switches.js";

// The framework-route boot check of a target entry (ADR 0012 "The boot check"): its `frameworkRoutes` allow-list
// and its `artefacts.bootCheck.frameworkRoutes` switch, for a target that generates the check.

const FRAMEWORK_ROUTE_CHECK = "frameworkRoutes";
const HOOK_CHECK = "hooks";

/**
 * The check the entry asks: off when switched off, else on with the entry's allow-list, copied, over the app routes
 * that overlap the contract's base paths, or every app route when `strict`.
 */
export function frameworkRouteCheckOf(entry: TargetEntry): FrameworkRouteCheck {
  if (isFrameworkRouteCheckOff(entry.artefacts)) return { status: "off" };

  return {
    status: "on",
    allowed: (entry.frameworkRoutes ?? []).map((allowance) => ({
      ...(allowance.method === undefined ? {} : { method: allowance.method }),
      path: allowance.path,
      reason: allowance.reason,
    })),
    scope: isFrameworkRouteCheckStrict(entry.artefacts) ? "strict" : "contract",
  };
}

/** A refusal per boot-check key the entry writes for a target that generates no such check. */
export function unreadFrameworkRouteKeyProblems(entry: TargetEntry, target: Target): CliProblem[] {
  const generates = (check: TunableBootCheck) =>
    target.metadata.bootChecks?.includes(check) === true;
  const frameworkRouteKeys = [
    ...(entry.frameworkRoutes === undefined ? [] : ["frameworkRoutes"]),
    ...(frameworkRoutesSwitchOf(entry.artefacts) === undefined
      ? []
      : ["artefacts.bootCheck.frameworkRoutes"]),
  ];
  const hookKeys =
    hookCheckSwitchOf(entry.artefacts) === undefined ? [] : ["artefacts.bootCheck.hooks"];
  // A target that checks the app's routes is one that serves the contract's: it alone reads `mount`.
  const mountKeys = entry.mount === undefined ? [] : ["mount"];
  const unreadKeys = [
    ...(generates(FRAMEWORK_ROUTE_CHECK) ? [] : [...frameworkRouteKeys, ...mountKeys]),
    ...(generates(HOOK_CHECK) ? [] : hookKeys),
  ];

  return unreadKeys.map((key) => ({
    code: "config.key.unsupported",
    message: `The target '${entry.use}' generates no boot check that reads '${key}'.`,
    fix: `Remove '${key}' from the entry; it belongs to a server target's entry.`,
    where: entryWhere(entry.id),
  }));
}
