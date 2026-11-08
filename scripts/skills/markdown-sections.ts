// Cuts the sections of a Markdown page by heading, for the references the skills copy from docs/.

const HEADING_LINE = /^(#{1,6}) +(.+?) *$/;
const FENCE_LINE = /^(`{3,}|~{3,})/;

interface HeadingLine {
  readonly depth: number;
  readonly title: string;
  readonly lineIndex: number;
}

function headingLines(lines: readonly string[]): HeadingLine[] {
  const headings: HeadingLine[] = [];
  let openFence: string | undefined;

  lines.forEach((line, lineIndex) => {
    const fence = FENCE_LINE.exec(line)?.[1];

    if (fence !== undefined) {
      openFence = openFence === undefined ? fence : undefined;

      return;
    }

    if (openFence !== undefined) return;

    const match = HEADING_LINE.exec(line);

    if (match?.[1] === undefined || match[2] === undefined) return;

    headings.push({ depth: match[1].length, title: match[2], lineIndex });
  });

  return headings;
}

/** The text of the page without its first heading line: the page body. */
export function pageBody(markdown: string): string {
  const lines = markdown.split("\n");
  const first = headingLines(lines)[0];

  if (first === undefined) return markdown.trim();

  return lines
    .slice(first.lineIndex + 1)
    .join("\n")
    .trim();
}

/** The first heading of the page, without its `#`. */
export function pageTitle(markdown: string): string {
  const first = headingLines(markdown.split("\n"))[0];

  if (first === undefined) throw new Error("The page has no heading, so it has no title.");

  return first.title;
}

/** The section under the heading `title` (heading line included) up to the next heading of the same or a higher level. */
export function sectionOf(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  const headings = headingLines(lines);
  const index = headings.findIndex((heading) => heading.title === title);
  const heading = headings[index];

  if (heading === undefined) throw new Error(`No heading '${title}' in the page.`);

  const next = headings.slice(index + 1).find((later) => later.depth <= heading.depth);

  return lines
    .slice(heading.lineIndex, next === undefined ? lines.length : next.lineIndex)
    .join("\n")
    .trim();
}

export function hasSection(markdown: string, title: string): boolean {
  return headingLines(markdown.split("\n")).some((heading) => heading.title === title);
}
