// The prebuild of the docs site: copies docs/ into Starlight's content folder, takes each page's title from its first heading, rewrites relative links to site routes or GitHub links, and writes the sidebar from the docs index.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { folderIndexMarkdown, type ListedPage, pagesDirectlyIn } from "./folder-index.ts";
import type { LinkContext } from "./link-target.ts";
import { parseMarkdown } from "./markdown-tree.ts";
import { type BrokenLink, transformPage } from "./page-transform.ts";
import { buildSidebar, type SidebarEntry } from "./sidebar.ts";
import { type SiteLayout, siteLayoutFrom } from "./site-layout.ts";
import { folderIndexDocsPath, listSourcePages } from "./source-pages.ts";

export type { SidebarEntry } from "./sidebar.ts";
export { SITE_BASE, SITE_URL } from "./site-layout.ts";

const INDEX_DOCS_PATH = "README.md";

/** What the prebuild wrote, for its summary line. */
export interface SiteContentSummary {
  pageCount: number;
  writtenFolderIndexes: string[];
  pagesOutsideSidebar: string[];
}

/** Regenerates the content folder and the sidebar from docs/; stops on any link the site cannot serve. */
export function buildSiteContent(packageRoot: string): SiteContentSummary {
  const layout = siteLayoutFrom(packageRoot);
  const pagesByDocsPath = listSourcePages(layout.docsRoot);
  const folders = new Set(
    [...pagesByDocsPath.values()]
      .map((page) => posix.dirname(page.slug))
      .filter((folder) => folder !== "."),
  );
  const foldersWithoutReadme = new Set(
    [...folders].filter((folder) => !pagesByDocsPath.has(folderIndexDocsPath(folder))),
  );
  const context: LinkContext = {
    repositoryRoot: layout.repositoryRoot,
    pagesByDocsPath,
    indexedFolders: folders,
  };

  const writtenPages = new Map<string, string>();
  const listedPages: ListedPage[] = [];
  const brokenLinks: BrokenLink[] = [];

  for (const page of pagesByDocsPath.values()) {
    const transformed = transformPage(
      readFileSync(join(layout.docsRoot, page.docsPath), "utf8"),
      page.docsPath,
      context,
    );

    writtenPages.set(page.contentPath, transformed.markdown);
    listedPages.push({ slug: page.slug, title: transformed.title });
    brokenLinks.push(...transformed.brokenLinks);
  }

  if (brokenLinks.length > 0) throw new Error(brokenLinksMessage(brokenLinks));

  const indexTree = parseMarkdown(readFileSync(join(layout.docsRoot, INDEX_DOCS_PATH), "utf8"));
  const sidebar = buildSidebar(indexTree, foldersWithoutReadme, context);

  for (const folder of foldersWithoutReadme) {
    const folderTitle = sidebar.folderTitles.get(folder);

    if (folderTitle === undefined) {
      throw new Error(
        `docs/${folder}/ has no README and docs/${INDEX_DOCS_PATH} names it nowhere, so its index page has no title. Link the folder from the docs index.`,
      );
    }

    writtenPages.set(
      posix.join(folder, "index.md"),
      folderIndexMarkdown(folderTitle, pagesDirectlyIn(folder, listedPages)),
    );
  }

  writeSiteContent(layout, writtenPages, sidebar.entries);

  return {
    pageCount: writtenPages.size,
    writtenFolderIndexes: [...foldersWithoutReadme].sort(),
    pagesOutsideSidebar: listedPages
      .map((page) => page.slug)
      .filter(
        (slug) =>
          slug !== "" &&
          !sidebar.coveredSlugs.has(slug) &&
          !sidebar.coveredSlugs.has(`${posix.dirname(slug)}/`),
      ),
  };
}

function writeSiteContent(
  layout: SiteLayout,
  writtenPages: Map<string, string>,
  sidebarEntries: SidebarEntry[],
): void {
  rmSync(layout.contentRoot, { recursive: true, force: true });

  for (const [contentPath, markdown] of writtenPages) {
    const pageFile = join(layout.contentRoot, contentPath);

    mkdirSync(dirname(pageFile), { recursive: true });
    writeFileSync(pageFile, markdown);
  }

  mkdirSync(dirname(layout.sidebarFile), { recursive: true });
  writeFileSync(layout.sidebarFile, `${JSON.stringify(sidebarEntries, null, 2)}\n`);
}

function brokenLinksMessage(brokenLinks: BrokenLink[]): string {
  const lines = brokenLinks.map((link) => `  docs/${link.docsPath}:${link.line}: ${link.reason}`);

  return `${brokenLinks.length} link(s) of docs/ cannot be served by the site. Fix each one:\n${lines.join("\n")}`;
}
