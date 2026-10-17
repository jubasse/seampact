import type { Origin } from "@seampact/spec/ir";
import type { DiagnosticOrigin, RelatedLocation } from "../../../diagnostics/diagnostic.js";
import type { PassContext } from "../../../pipeline/seam.js";

// The diagnostics of the access.identity half (ADR 0006 section 4): rule `seampact/access/<rule>`, located at a
// pointer of the merged raw tree through the api's side table.

/** The rules this half reports, each `seampact/access/<rule>`. */
export type AccessIdentityRule =
  | "scheme-member"
  | "scheme-reference"
  | "scheme-kind"
  | "signature-verify"
  | "signature-template"
  | "signature-tolerance"
  | "signature-key"
  | "identity-member"
  | "principal"
  | "principal-field"
  | "header-declaration"
  | "header-use"
  | "deny-by-default"
  | "identity-reference"
  | "optional-identity"
  | "access-schemes"
  | "signed-access"
  | "signature-key-source"
  | "scheme-query-field"
  | "csrf-header"
  | "service-identity"
  | "service-access"
  | "binding-source"
  | "binding-conflict";

export interface AccessIdentityRelated {
  /** A pointer of the merged raw tree. */
  pointer: string;
  message: string;
}

export interface AccessIdentityProblem {
  rule: AccessIdentityRule;
  message: string;
  fix: string;
  /** The pointer of the merged raw tree the diagnostic is located at. */
  pointer: string;
  related?: AccessIdentityRelated[];
}

export interface AccessIdentityReporter {
  error(problem: AccessIdentityProblem): void;
  /** The number of errors reported so far, so a builder knows whether its element had one. */
  readonly errors: number;
}

const isDiagnosticOrigin = (origin: Origin): origin is DiagnosticOrigin => origin.layer !== "core";

/** Reports the half's errors through its context, each located at its pointer. */
export function accessIdentityReporter(context: PassContext): AccessIdentityReporter {
  let errors = 0;

  // Every pointer reported is one the half read from the raw tree, so it always has an origin.
  const locate = (pointer: string): DiagnosticOrigin => {
    const origin = context.origin(pointer);
    if (origin === undefined || !isDiagnosticOrigin(origin))
      throw new Error(`access.identity located a diagnostic at ${pointer}, which has no origin`);
    return origin;
  };

  return {
    error(problem) {
      errors += 1;
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

/**
 * A reporter that reports a problem once: a setting written on a node reaches every route below it, so a problem
 * that does not name the route would repeat. `errors` counts every problem, repeated or not, so a builder still
 * knows its element had one.
 */
export function accessIdentityOnceReporter(
  reporter: AccessIdentityReporter,
): AccessIdentityReporter {
  const reported = new Set<string>();
  let errors = 0;

  return {
    error(problem) {
      errors += 1;
      const key = JSON.stringify([problem.rule, problem.pointer, problem.message]);
      if (reported.has(key)) return;
      reported.add(key);
      reporter.error(problem);
    },
    get errors() {
      return errors;
    },
  };
}
