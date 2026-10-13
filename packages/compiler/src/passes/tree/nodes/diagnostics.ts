import type { Origin } from "@seampact/spec/ir";
import type {
  Diagnostic,
  DiagnosticOrigin,
  RelatedLocation,
} from "../../../diagnostics/diagnostic.js";
import { pipelineCopy } from "../../../pipeline/seam.js";

// The diagnostics of tree.nodes: every rule is `seampact/tree/<rule>`, located at an origin of a layer (never
// `core`, which has no file), with `related` naming the other side of a conflict.

/** The rules tree.nodes reports, without their `seampact/tree/` prefix. */
export type TreeNodesRule =
  | "collection-singular"
  | "operation-id-unique"
  | "operation-name-unique"
  | "input-file"
  | "input-file-size"
  | "form-input"
  | "form-field";

export const treeNodesRuleId = (rule: TreeNodesRule): string => `seampact/tree/${rule}`;

const isDiagnosticOrigin = (origin: Origin): origin is DiagnosticOrigin => origin.layer !== "core";

/**
 * The origin a diagnostic is located at: `origin` itself, or `fallback` when `origin` is a core declaration, which
 * no file holds (a core schema's property, reached from a route's input).
 */
export function treeNodesLocate(origin: Origin, fallback: DiagnosticOrigin): DiagnosticOrigin {
  return pipelineCopy(isDiagnosticOrigin(origin) ? origin : fallback);
}

/** An origin of the merged raw tree as a diagnostic origin; a tree node's origin is never `core`. */
export function treeNodesNodeOrigin(origin: Origin): DiagnosticOrigin {
  if (!isDiagnosticOrigin(origin))
    throw new Error(
      `a tree node has a core origin (${origin.pointer}); every node is written in a layer`,
    );
  return pipelineCopy(origin);
}

export interface TreeNodesDiagnosticOptions {
  readonly rule: TreeNodesRule;
  readonly origin: DiagnosticOrigin;
  readonly message: string;
  readonly fix: string;
  readonly related?: readonly RelatedLocation[];
}

export function treeNodesError(options: TreeNodesDiagnosticOptions): Diagnostic {
  return {
    severity: "error",
    rule: treeNodesRuleId(options.rule),
    message: options.message,
    fix: options.fix,
    origin: options.origin,
    related: [...(options.related ?? [])],
  };
}
