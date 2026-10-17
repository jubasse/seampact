import { operationId, splitName } from "@seampact/spec/naming";
import type { ResolvedConventions, TreeNode } from "../../../pipeline/seam.js";
import type { TreeNodesSurfacePrefixes } from "./api.js";
import type { TreeNodesContext } from "./fields.js";
import { type TreeNodesRawSchemas, treeNodesIdParam, treeNodesOpShorthand } from "./names.js";
import { treeNodesText } from "./raw.js";

// Operation paths (ADR 0002 section 6): the surface's resolved prefix, then one segment per node down to the route.
// A node's segment is its name in `conventions.pathCase`, or its `path` (relative, possibly empty or several
// segments); a collection's member scope adds `{<id parameter>}`; an op's segment is its own `path`, else
// `conventions.ops.<op>.path`, relative to its scope. A relay route's path is copied from the operation it relays.

type PathCase = "kebab" | "camel" | "snake";

const PATH_CASES: readonly PathCase[] = ["kebab", "camel", "snake"];

function pathCaseOf(conventions: ResolvedConventions): PathCase {
  const written = conventions.get("pathCase")?.value;
  const pathCase = PATH_CASES.find((candidate) => candidate === written);
  if (pathCase === undefined)
    throw new Error(
      `conventions.pathCase resolves to ${String(written)}, no case the grammar admits`,
    );
  return pathCase;
}

function segmentOfName(name: string, pathCase: PathCase): string {
  const words = splitName(name);
  if (pathCase === "camel") return operationId(words, "camel");
  return words.join(pathCase === "kebab" ? "-" : "_");
}

function opSegment(node: TreeNode, conventions: ResolvedConventions): string {
  const own = treeNodesText(node, "path");
  if (own !== undefined) return own;
  const op = treeNodesOpShorthand(node);
  if (op === undefined) throw new Error(`the op at ${node.pointer} is no op the grammar admits`);

  const convention = conventions.get(`ops.${op}.path`)?.value;
  if (typeof convention !== "string")
    throw new Error(`conventions.ops.${op}.path resolves to no path`);
  return convention;
}

function segmentOf(
  node: TreeNode,
  pathCase: PathCase,
  conventions: ResolvedConventions,
  schemas: TreeNodesRawSchemas,
): string {
  if (node.kind === "op") return opSegment(node, conventions);
  if (node.kind === "scope") {
    const idParam =
      node.name === "member" && node.parent !== undefined
        ? treeNodesIdParam(node.parent, schemas)
        : undefined;
    return idParam === undefined ? "" : `{${idParam}}`;
  }
  return treeNodesText(node, "path") ?? segmentOfName(node.name, pathCase);
}

/** An operation's path, and the surface prefix it starts with (whose braces are no path parameters). */
export interface TreeNodesPath {
  readonly full: string;
  readonly prefix: string;
}

/** The path of an operation node; undefined for a relay route, whose path is copied. */
export function treeNodesPath(
  node: TreeNode,
  prefixes: TreeNodesSurfacePrefixes,
  { conventions, raw }: TreeNodesContext,
): TreeNodesPath | undefined {
  if (node.kind === "relay") return undefined;

  const pathCase = pathCaseOf(conventions);
  const segments: string[] = [];
  let surface = node;
  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) {
    if (at.parent === undefined) surface = at;
    else segments.unshift(segmentOf(at, pathCase, conventions, raw.merged.schemas));
  }

  const prefix = prefixes.get(surface.name);
  if (prefix === undefined) throw new Error(`the surface ${surface.name} has no resolved prefix`);

  const path = [prefix, ...segments.filter((segment) => segment !== "")].join("/");
  return { full: path === "" ? "/" : path, prefix };
}
