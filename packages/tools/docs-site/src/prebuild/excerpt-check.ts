import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMarkdown } from "./markdown-tree.ts";

const EXCERPT_MARKER = /^<!--\s*excerpt:\s*(\S+)\s*-->$/;
const ELISION_LINE = /^\s*(\.\.\.|\/\/ \.\.\.|# \.\.\.)\s*$/;

/** One excerpt a page claims: the golden file it comes from and the lines it shows. */
export interface PageExcerpt {
  goldenPath: string;
  lines: string[];
}

/** The excerpts of a page: each `<!-- excerpt: <path> -->` comment and the code fence right after it. */
export function listPageExcerpts(markdown: string, pageName: string): PageExcerpt[] {
  const excerpts: PageExcerpt[] = [];
  const nodes = parseMarkdown(markdown).children;

  nodes.forEach((node, index) => {
    if (node.type !== "html") return;

    const goldenPath = EXCERPT_MARKER.exec(node.value.trim())?.[1];

    if (goldenPath === undefined) return;

    const fence = nodes[index + 1];

    if (fence?.type !== "code") {
      throw new Error(
        `${pageName}: the excerpt marker for ${goldenPath} is not followed by a code fence.`,
      );
    }

    excerpts.push({ goldenPath, lines: fence.value.split("\n") });
  });

  return excerpts;
}

/** The excerpt lines the golden does not show in order, empty when the excerpt is true. Elision lines are skipped. */
export function missingExcerptLines(excerpt: PageExcerpt, goldenContent: string): string[] {
  const goldenLines = goldenContent.split("\n").map((line) => line.trimEnd());
  let nextGoldenLine = 0;

  for (const [position, line] of excerpt.lines.entries()) {
    if (line.trim() === "" || ELISION_LINE.test(line)) continue;

    const found = goldenLines.indexOf(line.trimEnd(), nextGoldenLine);

    if (found === -1) return excerpt.lines.slice(position).filter((rest) => rest.trim() !== "");

    nextGoldenLine = found + 1;
  }

  return [];
}

/** The problems of a page's excerpts against the golden files under `repositoryRoot`, one sentence each. */
export function checkPageExcerpts(
  markdown: string,
  pageName: string,
  repositoryRoot: string,
): string[] {
  const problems: string[] = [];

  for (const excerpt of listPageExcerpts(markdown, pageName)) {
    const missing = missingExcerptLines(excerpt, readGolden(repositoryRoot, excerpt.goldenPath));

    if (missing.length > 0) {
      problems.push(
        `${pageName}: ${excerpt.goldenPath} does not show, in order, the line ${JSON.stringify(missing[0])}.`,
      );
    }
  }

  return problems;
}

function readGolden(repositoryRoot: string, goldenPath: string): string {
  return readFileSync(join(repositoryRoot, goldenPath), "utf8");
}
