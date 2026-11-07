import type { Heading } from "mdast";
import { visit } from "unist-util-visit";
import { parseMarkdown, plainText, sourceRange } from "./markdown-tree.ts";

/** Selects the text before the first heading of a page. */
export const PAGE_INTRODUCTION = "(introduction)";

/**
 * The text of one section: its heading and everything below it, down to the next heading of the same
 * or a higher level. `PAGE_INTRODUCTION` is the text between the page title and its first section.
 * Returns undefined when the page has no such heading.
 */
export function sectionOf(markdown: string, headingText: string): string | undefined {
  const tree = parseMarkdown(markdown);
  const headings = tree.children.filter((block): block is Heading => block.type === "heading");

  if (headingText === PAGE_INTRODUCTION) return introductionOf(markdown, headings);

  const index = headings.findIndex((heading) => plainText(heading).trim() === headingText);
  const heading = headings[index];

  if (heading === undefined) return undefined;

  const next = headings.slice(index + 1).find((later) => later.depth <= heading.depth);
  const end = next === undefined ? markdown.length : sourceRange(next, "section").start;

  return markdown.slice(sourceRange(heading, "section").start, end).trimEnd();
}

function introductionOf(markdown: string, headings: Heading[]): string | undefined {
  const title = headings[0];
  const firstSection = headings[1];

  if (title === undefined) return undefined;

  const start = sourceRange(title, "section").end;
  const end =
    firstSection === undefined ? markdown.length : sourceRange(firstSection, "section").start;

  return markdown.slice(start, end).trim();
}

/** The section with the links to its own page reduced to their text; links to other pages keep their URL. */
export function withoutPageAnchors(markdown: string): string {
  const tree = parseMarkdown(markdown);
  const edits: { start: number; end: number; text: string }[] = [];

  visit(tree, "link", (link) => {
    if (!link.url.startsWith("#")) return;

    const { start, end } = sourceRange(link, "section");

    edits.push({ start, end, text: link.children.map((child) => plainText(child)).join("") });
  });

  let plain = markdown;

  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    plain = `${plain.slice(0, edit.start)}${edit.text}${plain.slice(edit.end)}`;
  }

  return plain;
}
