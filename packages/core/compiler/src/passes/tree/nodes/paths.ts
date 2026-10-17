import type { Origin } from "@seampact/spec/ir";
import { operationId, splitName } from "@seampact/spec/naming";
import type { ResolvedConventions, TreeNode } from "../../../pipeline/seam.js";
import type { TreeNodesSurfacePrefixes } from "./api.js";
import { treeNodesError, treeNodesLocate, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesContext, TreeNodesSite } from "./fields.js";
import { treeNodesIdParam, treeNodesOpShorthand } from "./names.js";
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

/** The piece of a path one node adds: its text (possibly empty, or several segments) and where it is written. */
export interface TreeNodesPathPart {
  readonly text: string;
  readonly origin: Origin;
  /** Written by the author (a node's or op's `path`, `conventions.ops.<op>.path`), not derived from a name or id. */
  readonly written: boolean;
}

/** An operation's path, the surface prefix it starts with (whose braces are no path parameters), and its parts. */
export interface TreeNodesPath {
  readonly full: string;
  readonly prefix: string;
  readonly parts: readonly TreeNodesPathPart[];
}

interface PathSite {
  readonly context: TreeNodesContext;
  readonly pathCase: PathCase;
}

function writtenPart(site: PathSite, node: TreeNode, text: string): TreeNodesPathPart {
  const origin = site.context.origin(`${node.pointer}/path`) ?? node.origin;
  return { text, origin, written: true };
}

function opPart(site: PathSite, node: TreeNode): TreeNodesPathPart {
  const own = treeNodesText(node, "path");
  if (own !== undefined) return writtenPart(site, node, own);
  const op = treeNodesOpShorthand(node);
  if (op === undefined) throw new Error(`the op at ${node.pointer} is no op the grammar admits`);

  const convention = site.context.conventions.get(`ops.${op}.path`);
  if (typeof convention?.value !== "string")
    throw new Error(`conventions.ops.${op}.path resolves to no path`);
  return { text: convention.value, origin: convention.origin ?? node.origin, written: true };
}

function partOf(site: PathSite, node: TreeNode): TreeNodesPathPart {
  if (node.kind === "op") return opPart(site, node);
  if (node.kind === "scope") {
    const idParam =
      node.name === "member" && node.parent !== undefined
        ? treeNodesIdParam(node.parent, site.context.raw.merged.schemas)
        : undefined;
    return {
      text: idParam === undefined ? "" : `{${idParam}}`,
      origin: node.origin,
      written: false,
    };
  }

  const own = treeNodesText(node, "path");
  if (own !== undefined) return writtenPart(site, node, own);
  return { text: segmentOfName(node.name, site.pathCase), origin: node.origin, written: false };
}

/** The path of an operation node; undefined for a relay route, whose path is copied. */
export function treeNodesPath(
  node: TreeNode,
  prefixes: TreeNodesSurfacePrefixes,
  context: TreeNodesContext,
): TreeNodesPath | undefined {
  if (node.kind === "relay") return undefined;

  const site: PathSite = { context, pathCase: pathCaseOf(context.conventions) };
  const parts: TreeNodesPathPart[] = [];
  let surface = node;
  for (let at: TreeNode | undefined = node; at !== undefined; at = at.parent) {
    if (at.parent === undefined) surface = at;
    else parts.unshift(partOf(site, at));
  }

  const prefix = prefixes.get(surface.name);
  if (prefix === undefined) throw new Error(`the surface ${surface.name} has no resolved prefix`);

  const texts = parts.map(({ text }) => text).filter((text) => text !== "");
  const path = [prefix, ...texts].join("/");
  return { full: path === "" ? "/" : path, prefix, parts };
}

// A written path is relative segments the router reads as written: no leading `/`, no empty, `.` or `..` segment,
// and no `?`, `#` or `%`, which a URL reads as a query, a fragment or an escape (ADR 0002 section 6).
const PATH_SEGMENT_CHECKS: readonly {
  readonly refuses: (text: string) => boolean;
  readonly why: string;
}[] = [
  { refuses: (text) => text.startsWith("/"), why: "starts with /" },
  {
    refuses: (text) => text !== "" && text.split("/").some((segment) => segment === ""),
    why: "holds an empty segment",
  },
  {
    refuses: (text) => text.split("/").some((segment) => segment === "." || segment === ".."),
    why: "holds a . or .. segment",
  },
  { refuses: (text) => /[?#%]/.test(text), why: "holds ?, # or %" },
];

/** Reports, once where it is written, each written path part a router would not read as relative segments. */
export function treeNodesCheckPathParts(site: TreeNodesSite, path: TreeNodesPath): void {
  for (const part of path.parts) {
    if (!part.written) continue;
    const why = PATH_SEGMENT_CHECKS.find(({ refuses }) => refuses(part.text))?.why;
    if (why === undefined) continue;

    const origin = treeNodesLocate(part.origin, treeNodesNodeOrigin(site.node.origin));
    site.once(
      `path-segment:${origin.layer}#${origin.pointer}`,
      treeNodesError({
        rule: "path-segment",
        origin,
        message: `The path ${part.text} written for ${site.operationId} ${why}; a path is relative segments.`,
        fix: "Write the path as segments separated by /, without / at either end, ., .., ?, # or %.",
      }),
    );
  }
}
