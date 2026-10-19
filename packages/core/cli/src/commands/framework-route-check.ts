import type { FrameworkRouteCheck, Target } from "@seampact/codegen-core";
import type { TargetEntry } from "@seampact/spec/config";
import { type CliProblem, entryWhere } from "../cli-problem.js";

// The framework-route boot check of a target entry (ADR 0012 "The boot check"): its `frameworkRoutes` allow-list
// and its `artefacts.bootCheck.frameworkRoutes` switch, for a target that generates the check.

const FRAMEWORK_ROUTE_CHECK = "frameworkRoutes";

/** The check the entry asks: off when switched off, else on with the entry's allow-list, copied. */
export function frameworkRouteCheckOf(entry: TargetEntry): FrameworkRouteCheck {
  if (entry.artefacts?.bootCheck?.frameworkRoutes === false) return { status: "off" };

  return {
    status: "on",
    allowed: (entry.frameworkRoutes ?? []).map((allowance) => ({
      ...(allowance.method === undefined ? {} : { method: allowance.method }),
      path: allowance.path,
      reason: allowance.reason,
    })),
  };
}

/** A refusal per framework-route key the entry writes for a target that generates no such check. */
export function unreadFrameworkRouteKeyProblems(entry: TargetEntry, target: Target): CliProblem[] {
  if (target.metadata.bootChecks?.includes(FRAMEWORK_ROUTE_CHECK) === true) return [];

  const writtenKeys = [
    ...(entry.frameworkRoutes === undefined ? [] : ["frameworkRoutes"]),
    ...(entry.artefacts?.bootCheck?.frameworkRoutes === undefined
      ? []
      : ["artefacts.bootCheck.frameworkRoutes"]),
  ];

  return writtenKeys.map((key) => ({
    code: "config.key.unsupported",
    message: `The target '${entry.use}' generates no framework-route boot check, so it cannot read '${key}'.`,
    fix: `Remove '${key}' from the entry; it belongs to a server target's entry.`,
    where: entryWhere(entry.id),
  }));
}
