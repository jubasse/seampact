import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** The GitHub-flavoured Markdown tree of a page, with source positions, as GitHub reads it. */
export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** The text a reader sees in a node: code spans keep their text, markup is dropped. */
export function plainText(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;

  if (!("children" in node)) return "";

  return node.children.map((child) => plainText(child)).join("");
}

/** The source offsets of a node, refused when the parser gave none. */
export function sourceRange(node: Nodes, sourceName: string): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  if (start === undefined || end === undefined) {
    throw new Error(`${sourceName}: the Markdown parser gave no position for a ${node.type} node.`);
  }

  return { start, end };
}
