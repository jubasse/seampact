import type { Origin } from "@seampact/spec/ir";

// ADR 0006 section 4
export interface Diagnostic {
  severity: "error" | "warning";
  rule: string;
  message: string;
  fix: string;
  origin: Origin;
  related: { origin: Origin; message: string }[];
}
