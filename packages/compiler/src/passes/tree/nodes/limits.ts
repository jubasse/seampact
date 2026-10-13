import type { Origin } from "@seampact/spec/ir";
import {
  type ConventionPath,
  type PassContextOf,
  pipelineParseSize,
  pipelineTreeNodes,
} from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import { treeNodesSetting } from "./raw.js";

// Body limits the size grammar admits but no safe integer holds (`9999999999PiB`): reported once where written,
// on a tree node or in the conventions, so no later check or derivation meets a limit it cannot read.

type TreeNodesContext = PassContextOf<"tree.nodes">;

const LIMIT_CONVENTIONS: readonly ConventionPath[] = ["bodyLimit", "batch.bodyLimit"];

/** Reports every written body limit that does not parse as a size. */
export function treeNodesCheckBodyLimits(context: TreeNodesContext): void {
  for (const node of pipelineTreeNodes(context.raw)) {
    const value = treeNodesSetting(node, "bodyLimit");
    if (value === undefined) continue;
    const origin = context.origin(`${node.pointer}/bodyLimit`) ?? node.origin;
    checkLimit(value, origin, context);
  }

  for (const path of LIMIT_CONVENTIONS) {
    const reading = context.conventions.get(path);
    const writtenHere = reading?.origin?.pointer === `/conventions/${path.replaceAll(".", "/")}`;
    if (reading?.origin !== undefined && writtenHere)
      checkLimit(reading.value, reading.origin, context);
  }
}

function checkLimit(value: unknown, origin: Origin, context: TreeNodesContext): void {
  if (typeof value === "string" && pipelineParseSize(value) !== undefined) return;

  context.report(
    treeNodesError({
      rule: "body-limit",
      origin: treeNodesNodeOrigin(origin),
      message: `The body limit ${String(value)} is larger than any size the compiler can check.`,
      fix: "Write a smaller bodyLimit, at most 8589934591MiB.",
    }),
  );
}
