import { posix } from "node:path";
import { siteRoute } from "./link-target.ts";
import { frontmatterFor } from "./page-transform.ts";

/** A page the folder index lists. */
export interface ListedPage {
  slug: string;
  title: string;
}

/** The index page of a docs/ folder with no README: its title, then a link to each of its pages. */
export function folderIndexMarkdown(folderTitle: string, pagesOfFolder: ListedPage[]): string {
  const pageLines = pagesOfFolder.map(
    (page) => `- [${escapeLinkText(page.title)}](${siteRoute(page.slug)})`,
  );

  return `${frontmatterFor({ title: folderTitle, editUrl: false })}${pageLines.join("\n")}\n`;
}

/** The pages directly in a folder, in path order. */
export function pagesDirectlyIn(folder: string, pages: ListedPage[]): ListedPage[] {
  return pages
    .filter((page) => posix.dirname(page.slug) === folder)
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function escapeLinkText(text: string): string {
  return text.replace(/[[\]\\]/g, "\\$&");
}
