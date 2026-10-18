import type { Origin } from "@seampact/spec/ir";
import type {
  Diagnostic,
  DiagnosticOrigin,
  RelatedLocation,
} from "../../../diagnostics/diagnostic.js";
import type { PassContext } from "../../../pipeline/seam.js";

// The diagnostics of the derive.wire half (ADR 0006 section 4): rule `seampact/derive/<rule>`, located at a pointer
// of the merged raw tree through the api's side table, with `related` naming the other side of a conflict. A core
// default has no location, so a problem about one is located at the route or the declaration that reaches it.

/** The rules this half reports, each `seampact/derive/<rule>`. */
export type DeriveWireRule =
  | "idempotency-convention"
  | "idempotency-exempt-unused"
  | "derived-name-collision"
  | "cache-method"
  | "cache-family"
  | "cache-freshness"
  | "cache-sensitive"
  | "bucket-limits";

export interface DeriveWireRelated {
  /** A pointer of the merged raw tree. */
  pointer: string;
  message: string;
}

export interface DeriveWireProblem {
  rule: DeriveWireRule;
  message: string;
  fix: string;
  /** The pointer of the merged raw tree the diagnostic is located at. */
  pointer: string;
  related?: DeriveWireRelated[];
}

export interface DeriveWireReporter {
  error(problem: DeriveWireProblem): void;
  warning(problem: DeriveWireProblem): void;
}

const isDiagnosticOrigin = (origin: Origin): origin is DiagnosticOrigin => origin.layer !== "core";

/** Reports the half's errors and warnings through its context, each located at its pointer. */
export function deriveWireReporter(context: PassContext): DeriveWireReporter {
  // Every pointer reported is one the half read from an authored layer, so it has an authored origin.
  const locate = (pointer: string): DiagnosticOrigin => {
    const origin = context.origin(pointer);

    if (origin === undefined)
      throw new Error(`derive.wire located a diagnostic at ${pointer}, which has no origin`);

    if (!isDiagnosticOrigin(origin))
      throw new Error(
        `derive.wire located a diagnostic at ${pointer}, whose origin is the core, not an authored layer`,
      );

    return origin;
  };

  const report = (severity: Diagnostic["severity"], problem: DeriveWireProblem): void => {
    const related: RelatedLocation[] = (problem.related ?? []).map((item) => ({
      origin: locate(item.pointer),
      message: item.message,
    }));

    context.report({
      severity,
      rule: `seampact/derive/${problem.rule}`,
      message: problem.message,
      fix: problem.fix,
      origin: locate(problem.pointer),
      related,
    });
  };

  return {
    error: (problem) => report("error", problem),
    warning: (problem) => report("warning", problem),
  };
}
