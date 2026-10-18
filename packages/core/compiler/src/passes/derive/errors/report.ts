import type { Origin } from "@seampact/spec/ir";
import type { DiagnosticOrigin, RelatedLocation } from "../../../diagnostics/diagnostic.js";
import type { PassContext } from "../../../pipeline/seam.js";

// The diagnostics of the derive.errors half (ADR 0006 section 4): rule `seampact/derive/<rule>`, located at a
// pointer of the merged raw tree through the api's side table, with `related` naming the other side of a conflict.
// A core declaration has no location, so a problem about one is located at the binding or the use that reads it.

/** The rules this half reports, each `seampact/derive/<rule>`. */
export type DeriveErrorsRule =
  | "error-redefined"
  | "error-unknown"
  | "error-pattern"
  | "error-nature"
  | "error-params"
  | "error-example"
  | "error-default"
  | "nature-base"
  | "role-code"
  | "role-datum"
  | "role-param"
  | "role-param-required"
  | "role-param-type"
  | "role-template"
  | "retry-param"
  | "relay-declaration";

export interface DeriveErrorsRelated {
  /** A pointer of the merged raw tree. */
  pointer: string;
  message: string;
}

export interface DeriveErrorsProblem {
  rule: DeriveErrorsRule;
  message: string;
  fix: string;
  /** The pointer of the merged raw tree the diagnostic is located at. */
  pointer: string;
  related?: DeriveErrorsRelated[];
}

export interface DeriveErrorsReporter {
  error(problem: DeriveErrorsProblem): void;
}

const isDiagnosticOrigin = (origin: Origin): origin is DiagnosticOrigin => origin.layer !== "core";

/** Reports the half's errors through its context, each located at its pointer. */
export function deriveErrorsReporter(context: PassContext): DeriveErrorsReporter {
  // Every pointer reported is one the half read from an authored layer, so it has an authored origin.
  const locate = (pointer: string): DiagnosticOrigin => {
    const origin = context.origin(pointer);

    if (origin === undefined)
      throw new Error(`derive.errors located a diagnostic at ${pointer}, which has no origin`);

    if (!isDiagnosticOrigin(origin))
      throw new Error(
        `derive.errors located a diagnostic at ${pointer}, whose origin is the core, not an authored layer`,
      );

    return origin;
  };

  return {
    error(problem) {
      const related: RelatedLocation[] = (problem.related ?? []).map((item) => ({
        origin: locate(item.pointer),
        message: item.message,
      }));

      context.report({
        severity: "error",
        rule: `seampact/derive/${problem.rule}`,
        message: problem.message,
        fix: problem.fix,
        origin: locate(problem.pointer),
        related,
      });
    },
  };
}
