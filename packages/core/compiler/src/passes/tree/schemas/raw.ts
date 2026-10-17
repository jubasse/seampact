import type { IrWriter } from "@seampact/spec/ir";
import type { DiagnosticOrigin } from "../../../diagnostics/diagnostic.js";
import type { PassContext, PassReadonly } from "../../../pipeline/seam.js";
import type { JsonObject, JsonValue } from "../../../raw-tree.js";

// What the tree.schemas modules share: the raw values they read, JSON Pointers, origins and the diagnostics they
// report (ADR 0006 section 4, rules `seampact/tree/<rule>`).

export type TreeSchemasRaw = PassReadonly<JsonValue>;
export type TreeSchemasRawObject = PassReadonly<JsonObject>;

export const treeSchemasIsObject = (
  value: TreeSchemasRaw | undefined,
): value is TreeSchemasRawObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The own member `key` of a raw mapping; undefined when absent or when `value` is no mapping. */
export function treeSchemasMember(
  value: TreeSchemasRaw | undefined,
  key: string,
): TreeSchemasRaw | undefined {
  return treeSchemasIsObject(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/** The own entries of a raw mapping, in written order; none when `value` is no mapping. */
export function treeSchemasEntries(
  value: TreeSchemasRaw | undefined,
): (readonly [string, TreeSchemasRaw])[] {
  return treeSchemasIsObject(value) ? Object.entries(value) : [];
}

const escapeSegment = (segment: string): string =>
  `/${segment.replaceAll("~", "~0").replaceAll("/", "~1")}`;

/** The pointer below `base` through `segments` (RFC 6901). */
export const treeSchemasPointer = (base: string, ...segments: readonly string[]): string =>
  base + segments.map(escapeSegment).join("");

/** A located problem of the half's run, its other locations by pointer. */
export interface TreeSchemasProblem {
  rule: string;
  pointer: string;
  message: string;
  fix: string;
  related?: readonly { pointer: string; message: string }[];
}

/** Origins and diagnostics at pointers of the merged raw tree. */
export class TreeSchemasReporter {
  constructor(private readonly context: PassContext) {}

  /** The origin of a node the half read; a pointer naming nothing is a bug of the half. */
  origin(pointer: string): IrWriter.Origin {
    const origin = this.context.origin(pointer);
    if (origin === undefined) throw new Error(`tree.schemas read no node at ${pointer}`);
    return origin;
  }

  error(problem: TreeSchemasProblem): void {
    this.context.report({
      severity: "error",
      rule: `seampact/tree/${problem.rule}`,
      message: problem.message,
      fix: problem.fix,
      origin: this.located(problem.pointer),
      related: (problem.related ?? []).map((other) => ({
        origin: this.located(other.pointer),
        message: other.message,
      })),
    });
  }

  private located(pointer: string): DiagnosticOrigin {
    const origin = this.origin(pointer);
    const layer = origin.layer;
    if (layer === "core") throw new Error(`tree.schemas located a diagnostic at core ${pointer}`);
    return { ...origin, layer };
  }
}
