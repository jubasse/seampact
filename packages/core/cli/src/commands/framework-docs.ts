import type { Target } from "@seampact/codegen-core";
import type { TargetEntry } from "@seampact/spec/config";
import { type CliProblem, entryWhere } from "../cli-problem.js";

// The `frameworkDocs` switch of a server target entry (ADR 0011 "Which OpenAPI documents exist"): `keep` leaves the
// framework's own document as the framework has it, `off` needs a switch the target writes, or a fix the target
// states for a framework that has none.

const OFF = "off";

const NO_SWITCH_FIX =
  "Remove `frameworkDocs: off` from the entry: this target writes no switch for its framework's own document.";

/** A refusal for `frameworkDocs` on a target that is no server, or `off` on a target that cannot switch the document off. */
export function frameworkDocsProblems(entry: TargetEntry, target: Target): CliProblem[] {
  if (entry.frameworkDocs === undefined) return [];

  if (target.metadata.role !== "server") {
    return [
      {
        code: "config.key.unsupported",
        message: `The target '${entry.use}' is no server target, so it cannot read 'frameworkDocs'.`,
        fix: "Remove 'frameworkDocs' from the entry; it belongs to a server target's entry.",
        where: entryWhere(entry.id),
      },
    ];
  }

  if (entry.frameworkDocs !== OFF) return [];

  return [
    {
      code: "config.frameworkDocs.unsupported",
      message: `The target '${entry.use}' cannot switch its framework's own OpenAPI document off.`,
      fix: target.metadata.frameworkDocsOffFix ?? NO_SWITCH_FIX,
      where: entryWhere(entry.id),
    },
  ];
}
