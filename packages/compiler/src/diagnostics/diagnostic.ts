import type { Origin } from "@seampact/spec/ir";

/**
 * Where a diagnostic is located: an origin of any layer but `core`. A core declaration has no file and no
 * side-table entry (ADR 0004 sections 6 and 11), so a diagnostic about one is located at the binding or the use
 * that pulled it in.
 */
export type DiagnosticOrigin = Origin & { layer: Exclude<Origin["layer"], "core"> };

export interface RelatedLocation {
  origin: DiagnosticOrigin;
  message: string;
}

// ADR 0006 section 4
export interface Diagnostic {
  severity: "error" | "warning";
  rule: string;
  message: string;
  fix: string;
  origin: DiagnosticOrigin;
  related: RelatedLocation[];
}
