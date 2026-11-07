import type { Definition, Link, Nodes, Root } from "mdast";
import { visit } from "unist-util-visit";
import { type LinkContext, resolveLinkTarget } from "./link-target.ts";
import { parseMarkdown, plainText, sourceRange } from "./markdown-tree.ts";
import { type PageHeading, readPageDescription, readPageHeading } from "./page-heading.ts";
import { placementFrontmatter } from "./page-policy.ts";
import { REPOSITORY_BRANCH, REPOSITORY_URL } from "./site-layout.ts";

/** A link of docs/ the site cannot serve, with where it is written. */
export interface BrokenLink {
  docsPath: string;
  line: number;
  reason: string;
}

/** A page as the site reads it: its frontmatter, and its body without the title heading. */
export interface TransformedPage {
  title: string;
  markdown: string;
  /** The page without frontmatter or title heading, links rewritten. */
  body: string;
  description: string | undefined;
  brokenLinks: BrokenLink[];
}

/** What the prebuild knows about a page beyond its source. */
export interface TransformOptions {
  lastUpdated?: Date | undefined;
  /** Descriptions earlier pages already use: a page takes another sentence rather than repeat one. */
  takenDescriptions?: ReadonlySet<string>;
}

interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
}

/** Turns one docs/ page into a site page: title and description in frontmatter, links rewritten. */
export function transformPage(
  source: string,
  docsPath: string,
  context: LinkContext,
  options: TransformOptions = {},
): TransformedPage {
  const sourceName = `docs/${docsPath}`;
  const tree = parseMarkdown(source);
  const heading = readPageHeading(tree, sourceName);
  const edits: SourceEdit[] = [
    { start: heading.start, end: endOfBlankLines(source, heading.end), replacement: "" },
  ];
  const brokenLinks: BrokenLink[] = [];

  edits.push(...headingLevelEdits(tree, source, heading, sourceName));

  visit(tree, ["image", "html"], (node) => {
    const line = node.position?.start.line ?? 0;

    for (const path of relativeAssetPaths(node)) {
      brokenLinks.push({
        docsPath,
        line,
        reason: `"${path}" is a relative image or file reference, which the site does not copy; use an absolute https URL`,
      });
    }
  });

  visit(tree, ["link", "definition"], (node) => {
    if (node.type !== "link" && node.type !== "definition") return;

    const { start } = sourceRange(node, sourceName);

    if (start >= heading.start && start < heading.end) return;

    const target = resolveLinkTarget(node.url, docsPath, context);

    if (target.kind === "broken") {
      brokenLinks.push({ docsPath, line: node.position?.start.line ?? 0, reason: target.reason });

      return;
    }

    if (target.kind === "textOnly" && node.type === "link") {
      edits.push({ ...sourceRange(node, sourceName), replacement: plainText(node) });

      return;
    }

    if (target.kind === "rewritten") {
      edits.push({ ...linkDestinationRange(source, node, sourceName), replacement: target.url });
    }
  });

  const description = readPageDescription(tree, options.takenDescriptions);
  const frontmatter = frontmatterFor({
    title: heading.title,
    description,
    ...placementFrontmatter(docsPath),
    lastUpdated: options.lastUpdated,
    editUrl: `${REPOSITORY_URL}/edit/${REPOSITORY_BRANCH}/${sourceName}`,
  });

  const body = applyEdits(source, edits);

  return {
    title: heading.title,
    markdown: `${frontmatter}${body}`,
    body,
    description,
    brokenLinks,
  };
}

/** The YAML frontmatter of a site page; JSON strings are valid YAML scalars. */
export function frontmatterFor(
  fields: Record<string, string | boolean | Date | undefined>,
): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(
      ([key, value]) =>
        `${key}: ${value instanceof Date ? value.toISOString() : JSON.stringify(value)}`,
    );

  return `---\n${lines.join("\n")}\n---\n\n`;
}

const FIRST_SECTION_DEPTH = 2;

/**
 * The page title becomes the page's h1, so the headings below it move up by as many levels as the
 * title sat below h1: a grammar section opens with an h3 title and its h4 headings become h2.
 */
function headingLevelEdits(
  tree: Root,
  source: string,
  title: PageHeading,
  sourceName: string,
): SourceEdit[] {
  const levelsUp = title.depth - 1;

  if (levelsUp === 0) return [];

  const edits: SourceEdit[] = [];

  visit(tree, "heading", (node) => {
    const { start } = sourceRange(node, sourceName);

    if (start === title.start) return;

    if (source[start] !== "#") {
      throw new Error(
        `${sourceName}:${node.position?.start.line}: this heading is not written with "#", so its level cannot move up with the title. Write it with "#".`,
      );
    }

    const markerEnd = start + node.depth;
    const newDepth = Math.max(FIRST_SECTION_DEPTH, node.depth - levelsUp);

    edits.push({ start, end: markerEnd, replacement: "#".repeat(newDepth) });
  });

  return edits;
}

const HTML_REFERENCE_PATTERN = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function isRelativeReference(url: string): boolean {
  return !(
    url === "" ||
    url.startsWith("#") ||
    url.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(url)
  );
}

function relativeAssetPaths(node: Nodes): string[] {
  if (node.type === "image") return isRelativeReference(node.url) ? [node.url] : [];

  if (node.type !== "html") return [];

  return [...node.value.matchAll(HTML_REFERENCE_PATTERN)]
    .map((match) => match[1] ?? match[2] ?? "")
    .filter(isRelativeReference);
}

function endOfBlankLines(source: string, offset: number): number {
  let end = offset;

  while (end < source.length && (source[end] === "\n" || source[end] === "\r")) end += 1;

  return end;
}

function applyEdits(source: string, edits: SourceEdit[]): string {
  let edited = source;

  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    edited = `${edited.slice(0, edit.start)}${edit.replacement}${edited.slice(edit.end)}`;
  }

  return edited;
}

/**
 * The source range of a link's destination: after `](` for an inline link, after `]:` for a
 * definition. The parser gives the node's range only, so the destination is found in it and
 * checked against the parsed URL; a mismatch stops the build rather than writing a wrong link.
 */
function linkDestinationRange(
  source: string,
  node: Link | Definition,
  sourceName: string,
): { start: number; end: number } {
  const { start, end } = sourceRange(node, sourceName);
  const nodeSource = source.slice(start, end);
  const labelEnd =
    node.type === "link" ? linkTextEnd(node, start, sourceName) - start : nodeSource.indexOf("]:");
  const opener = node.type === "link" ? "](" : "]:";

  if (labelEnd < 0 || nodeSource.slice(labelEnd, labelEnd + opener.length) !== opener) {
    throw new Error(
      `${sourceName}:${node.position?.start.line}: cannot find the destination of the link to "${node.url}".`,
    );
  }

  let destinationStart = labelEnd + opener.length;

  while (/\s/.test(nodeSource[destinationStart] ?? "")) destinationStart += 1;

  const isAngled = nodeSource[destinationStart] === "<";
  const contentStart = isAngled ? destinationStart + 1 : destinationStart;
  const terminator = isAngled ? /[>]/ : /[\s)]/;
  let contentEnd = contentStart;

  while (contentEnd < nodeSource.length && !terminator.test(nodeSource[contentEnd] ?? ""))
    contentEnd += 1;

  const rawDestination = nodeSource.slice(contentStart, contentEnd);

  if (rawDestination !== node.url && encodeURI(decodeURI(rawDestination)) !== node.url) {
    throw new Error(
      `${sourceName}:${node.position?.start.line}: the link destination "${rawDestination}" does not read as "${node.url}".`,
    );
  }

  return { start: start + destinationStart, end: start + (isAngled ? contentEnd + 1 : contentEnd) };
}

function linkTextEnd(node: Link, linkStart: number, sourceName: string): number {
  const lastChild = node.children.at(-1);

  return lastChild === undefined ? linkStart + 1 : sourceRange(lastChild, sourceName).end;
}
