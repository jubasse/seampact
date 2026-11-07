import { posix } from "node:path";
import { siteRoute } from "./link-target.ts";
import { cutDescription } from "./page-heading.ts";
import { placementFrontmatter } from "./page-policy.ts";
import { frontmatterFor } from "./page-transform.ts";

/** A page the folder index lists. */
export interface ListedPage {
  slug: string;
  title: string;
}

/** The index page of a docs/ folder with no README: its title, then a link to each of its pages. */
export function folderIndexMarkdown(
  folder: string,
  folderTitle: string,
  pagesOfFolder: ListedPage[],
): string {
  const pageLines = pagesOfFolder.map(
    (page) => `- [${escapeLinkText(page.title)}](${siteRoute(page.slug)})`,
  );

  const frontmatter = frontmatterFor({
    title: folderTitle,
    description: folderDescription(folderTitle, pagesOfFolder),
    ...placementFrontmatter(`${folder}/index.md`),
    editUrl: false,
  });

  return `${frontmatter}${pageLines.join("\n")}\n`;
}

/** The pages directly in a folder, in path order. */
export function pagesDirectlyIn(folder: string, pages: ListedPage[]): ListedPage[] {
  return pages
    .filter((page) => posix.dirname(page.slug) === folder)
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

const PAGES_NAMED_IN_DESCRIPTION = 4;

function folderDescription(folderTitle: string, pagesOfFolder: ListedPage[]): string {
  const named = pagesOfFolder.slice(0, PAGES_NAMED_IN_DESCRIPTION).map((page) => page.title);
  const more = pagesOfFolder.length > named.length ? " and more" : "";

  return cutDescription(`${folderTitle} pages of seampact: ${named.join(", ")}${more}.`);
}

function escapeLinkText(text: string): string {
  return text.replace(/[[\]\\]/g, "\\$&");
}
