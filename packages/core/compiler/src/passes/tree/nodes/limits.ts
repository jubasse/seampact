import type { Origin } from "@seampact/spec/ir";
import {
  type ConventionPath,
  pipelineParseSize,
  pipelineTreeNodes,
  type TreeNode,
} from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import { type TreeNodesContext, treeNodesSetting, treeNodesWrittenConvention } from "./raw.js";

// Body limits: a route's limit in bytes, and the limits the size grammar admits but no safe integer holds
// (`9999999999PiB`), reported once where written, on a tree node or in the conventions, so no later check or
// derivation meets a limit it cannot read.

const LIMIT_CONVENTIONS: readonly ConventionPath[] = ["bodyLimit", "batch.bodyLimit"];

const BYTES_PER_MIB = 2 ** 20;
const LARGEST_CHECKED_MIB = Math.floor(Number.MAX_SAFE_INTEGER / BYTES_PER_MIB);

/** A route's body limit in bytes, and where it is written. */
export interface TreeNodesBodyLimit {
  readonly bytes: number;
  /** Undefined for the core default. */
  readonly origin: Origin | undefined;
}

/**
 * The body limit of an operation node: the nearest `bodyLimit` of the tree, else the convention (`batch.bodyLimit`
 * for a batch). Undefined when a written limit does not parse: `treeNodesCheckBodyLimits` reports it, so no check
 * compares with it. A core default always parses.
 */
export function treeNodesBodyLimit(
  node: TreeNode,
  context: TreeNodesContext,
): TreeNodesBodyLimit | undefined {
  const inherited = context.inherited(node, "bodyLimit");
  if (inherited !== undefined) {
    const { value, origin } = inherited.entry;
    return parsedBodyLimit(value, origin, origin.pointer);
  }

  const isBatch = node.kind === "op" && node.name === "batch";
  const convention = isBatch ? "batch.bodyLimit" : "bodyLimit";
  const reading = context.conventions.get(convention);
  if (reading === undefined) return undefined;
  const writtenAt = reading.origin?.pointer ?? `the default conventions.${convention}`;
  return parsedBodyLimit(reading.value, reading.origin, writtenAt);
}

function parsedBodyLimit(
  value: unknown,
  origin: Origin | undefined,
  writtenAt: string,
): TreeNodesBodyLimit | undefined {
  const bytes = typeof value === "string" ? pipelineParseSize(value) : undefined;
  if (bytes !== undefined) return { bytes, origin };
  if (origin === undefined)
    throw new Error(`the body limit at ${writtenAt} does not parse as a size: ${String(value)}`);
  return undefined;
}

/** Reports every written body limit that does not parse as a size. */
export function treeNodesCheckBodyLimits(context: TreeNodesContext): void {
  for (const node of pipelineTreeNodes(context.raw)) {
    const value = treeNodesSetting(node, "bodyLimit");
    if (value === undefined) continue;
    const origin = context.origin(`${node.pointer}/bodyLimit`) ?? node.origin;
    checkLimit(value, origin, context);
  }

  for (const path of LIMIT_CONVENTIONS) {
    const reading = treeNodesWrittenConvention(context, path);
    if (reading !== undefined) checkLimit(reading.value, reading.origin, context);
  }
}

function checkLimit(value: unknown, origin: Origin, context: TreeNodesContext): void {
  if (typeof value === "string" && pipelineParseSize(value) !== undefined) return;

  context.report(
    treeNodesError({
      rule: "body-limit",
      origin: treeNodesNodeOrigin(origin),
      message: `The body limit ${String(value)} is larger than any size the compiler can check.`,
      fix: `Write a smaller bodyLimit, at most ${LARGEST_CHECKED_MIB}MiB.`,
    }),
  );
}
