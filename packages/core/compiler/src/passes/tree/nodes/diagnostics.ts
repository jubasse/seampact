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
  | "collection-id"
  | "operation-id-unique"
  | "operation-name-unique"
  | "route-unique"
  | "op-input"
  | "op-item"
  | "id-property"
  | "input-file"
  | "input-file-size"
  | "body-limit"
  | "form-input"
  | "form-field"
  | "api-version"
  | "path-version"
  | "path-param"
  | "path-segment"
  | "param-unique"
  | "query-field"
  | "fields-schema"
  | "opaque-position"
  | "union-header"
  | "redirect-body"
  | "responses-output"
  | "no-content-body"
  | "annotation-position"
  | "owner-concurrency"
  | "concurrency-inherit"
  | "concurrency-input"
  | "paging-list"
  | "paging-style"
  | "paging-unknown"
  | "paging-param"
  | "paging-sort"
  | "paging-limit"
  | "paging-token"
  | "sort-key"
  | "degradable-path"
  | "degradable-header"
  | "budget-duration"
  | "deprecated-sunset"
  | "deprecated-successor"
  | "upstream-service"
  | "internal-product"
  | "format-unknown"
  | "example-target"
  | "example-value";

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

/** Reports a diagnostic the first time its key is seen in a run of the half, and drops it after that. */
export type TreeNodesReportOnce = (key: string, diagnostic: Diagnostic) => void;

// A setting written above several operations (an inherited `query`, a collection's `id`) is checked once per
// operation it reaches, and reported once.
export function treeNodesReportOnce(report: (diagnostic: Diagnostic) => void): TreeNodesReportOnce {
  const reported = new Set<string>();

  return (key, diagnostic) => {
    if (reported.has(key)) return;
    reported.add(key);
    report(diagnostic);
  };
}
