import type { Origin } from "@seampact/spec/ir";
import type { DiagnosticOrigin, RelatedLocation } from "../../../diagnostics/diagnostic.js";
import type { PassContext } from "../../../pipeline/seam.js";

// The diagnostics of the access.rights half (ADR 0006 section 4): rule `seampact/access/<rule>`, located at a
// pointer of the merged raw tree through the api's side table, with `related` naming the other side of a conflict.

/** The rules this half reports, each `seampact/access/<rule>`. */
export type AccessRightsRule =
  | "right-name"
  | "right-pattern"
  | "right-subject"
  | "proof-schema"
  | "scope-within"
  | "bucket-key"
  | "bucket-window"
  | "scope-unknown"
  | "scope-twice"
  | "scope-nesting"
  | "requirement-entry"
  | "requirement-target"
  | "requirement-params"
  | "requirement-bucket"
  | "requirement-subject"
  | "requirement-twice"
  | "guest-right"
  | "caller-right"
  | "pack-template"
  | "pack-right";

export interface AccessRightsRelated {
  /** A pointer of the merged raw tree. */
  pointer: string;
  message: string;
}

export interface AccessRightsProblem {
  rule: AccessRightsRule;
  message: string;
  fix: string;
  /** The pointer of the merged raw tree the diagnostic is located at. */
  pointer: string;
  related?: AccessRightsRelated[];
}

export interface AccessRightsReporter {
  error(problem: AccessRightsProblem): void;
  /** The number of errors reported so far, so a builder knows whether its element had one. */
  readonly errors: number;
}

const isDiagnosticOrigin = (origin: Origin): origin is DiagnosticOrigin => origin.layer !== "core";

/**
 * Reports the half's errors through its context, each located at its pointer. An inherited setting is checked for
 * every route below it, so a rule at one place is reported once, with the message of the first route that hit it.
 */
export function accessRightsReporter(context: PassContext): AccessRightsReporter {
  let errors = 0;
  const reported = new Set<string>();

  // Every pointer reported is one the half read from the raw tree, so it always has an origin.
  const locate = (pointer: string): DiagnosticOrigin => {
    const origin = context.origin(pointer);
    if (origin === undefined || !isDiagnosticOrigin(origin))
      throw new Error(`access.rights located a diagnostic at ${pointer}, which has no origin`);
    return origin;
  };

  return {
    error(problem) {
      errors += 1;
      const key = JSON.stringify([problem.rule, problem.pointer]);
      if (reported.has(key)) return;
      reported.add(key);

      const related: RelatedLocation[] = (problem.related ?? []).map((item) => ({
        origin: locate(item.pointer),
        message: item.message,
      }));
      context.report({
        severity: "error",
        rule: `seampact/access/${problem.rule}`,
        message: problem.message,
        fix: problem.fix,
        origin: locate(problem.pointer),
        related,
      });
    },
    get errors() {
      return errors;
    },
  };
}
