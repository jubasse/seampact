import type { Root } from "mdast";
import { plainText, sourceRange } from "./markdown-tree.ts";

const DESCRIPTION_MAX_LENGTH = 160;

/** The title a page takes from its first heading, and the source range that heading spans. */
export interface PageHeading {
  title: string;
  start: number;
  end: number;
}

/**
 * A page's title is its first block, a heading of any level: most pages open with an H1, the
 * grammar and IR section files with the H3 of their ADR section.
 */
export function readPageHeading(tree: Root, sourceName: string): PageHeading {
  const firstBlock = tree.children[0];

  if (firstBlock?.type !== "heading") {
    throw new Error(
      `${sourceName}: the page does not open with a heading, so it has no title. Start it with a "# Title" line.`,
    );
  }

  const title = plainText(firstBlock).trim();

  if (title === "")
    throw new Error(`${sourceName}: the opening heading is empty. Give it the page's title.`);

  return { title, ...sourceRange(firstBlock, sourceName) };
}

/** The meta description: the first paragraph after the title, cut at a word under the length search engines show. */
export function readPageDescription(tree: Root): string | undefined {
  const firstParagraph = tree.children.slice(1).find((block) => block.type === "paragraph");

  if (firstParagraph === undefined) return undefined;

  const paragraphText = plainText(firstParagraph).replace(/\s+/g, " ").trim();

  if (paragraphText.length <= DESCRIPTION_MAX_LENGTH) return paragraphText;

  const cutAtWord = paragraphText.slice(0, DESCRIPTION_MAX_LENGTH).replace(/\s+\S*$/, "");

  return `${cutAtWord}...`;
}
