import type { Root } from "mdast";
import { plainText, sourceRange } from "./markdown-tree.ts";

const DESCRIPTION_MAX_LENGTH = 160;
const MIN_SENTENCE_CUT_LENGTH = 60;

/** The title a page takes from its first heading, and the source range that heading spans. */
export interface PageHeading {
  title: string;
  /** The heading level the page opened with (1 to 6). */
  depth: number;
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

  return { title, depth: firstBlock.depth, ...sourceRange(firstBlock, sourceName) };
}

/**
 * The meta description: the first real sentence of the page that no other page uses. A status line
 * ("Status: accepted") is no description, and a line that only introduces a list or code ("...as:")
 * comes last, since a search result that ends on a colon looks cut.
 */
export function readPageDescription(
  tree: Root,
  takenDescriptions: ReadonlySet<string> = new Set(),
): string | undefined {
  const blocks = tree.children.slice(1);
  const paragraphs = blocks.filter((block) => block.type === "paragraph").map(blockText);
  const listItems = blocks.filter((block) => block.type === "list").map(blockText);
  const introductions = paragraphs.filter((text) => text.endsWith(":"));
  const candidates = [
    ...paragraphs.filter((text) => !text.endsWith(":")),
    ...listItems,
    ...introductions.map((text) => `${text.slice(0, -1)}.`),
  ];

  return candidates
    .filter((text) => text !== "" && !/^status:/i.test(text))
    .map(cutDescription)
    .find((description) => !takenDescriptions.has(description));
}

/** A description cut at the last sentence end under the length search engines show, else at a word. */
export function cutDescription(text: string): string {
  if (text.length <= DESCRIPTION_MAX_LENGTH) return text;

  const room = text.slice(0, DESCRIPTION_MAX_LENGTH + 1);
  const lastSentenceEnd = [...room.matchAll(/[.!?](?=\s)/g)].at(-1)?.index ?? -1;

  if (lastSentenceEnd >= MIN_SENTENCE_CUT_LENGTH) return room.slice(0, lastSentenceEnd + 1);

  return `${room.slice(0, DESCRIPTION_MAX_LENGTH).replace(/\s+\S*$/, "")}...`;
}

function blockText(block: Root["children"][number]): string {
  const source = block.type === "list" ? block.children[0] : block;

  return source === undefined ? "" : plainText(source).replace(/\s+/g, " ").trim();
}
