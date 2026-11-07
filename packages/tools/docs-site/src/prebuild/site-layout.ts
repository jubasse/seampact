import { join } from "node:path";

/** Where the site lives on GitHub Pages and where links out of the site point. */
export const SITE_URL = "https://jubasse.github.io";
export const SITE_BASE = "/seampact/";
/** Where the raw Markdown twin of every user page is served: `<twin url><docs path>`. */
export const MARKDOWN_TWIN_URL = `${SITE_URL}${SITE_BASE}md/`;
/** The docs index page, from docs/. */
export const INDEX_DOCS_PATH = "README.md";
export const REPOSITORY_URL = "https://github.com/jubasse/seampact";
export const REPOSITORY_BRANCH = "develop";

/** The docs/ folders the site leaves out: contributor and agent material, not user documentation. */
export const FOLDERS_LEFT_OUT = ["agents", "conformance"] as const;

/** The paths the prebuild reads and writes, all absolute. */
export interface SiteLayout {
  repositoryRoot: string;
  docsRoot: string;
  contentRoot: string;
  sidebarFile: string;
  /** The site's static files: the prebuild writes the agent files here, beside the committed ones. */
  publicRoot: string;
  /** The site-only home page, written by hand, not taken from docs/. */
  homePageFile: string;
}

export function siteLayoutFrom(packageRoot: string): SiteLayout {
  const repositoryRoot = join(packageRoot, "..", "..", "..");

  return {
    repositoryRoot,
    docsRoot: join(repositoryRoot, "docs"),
    contentRoot: join(packageRoot, "site", "content", "docs"),
    publicRoot: join(packageRoot, "public"),
    sidebarFile: join(packageRoot, "site", "generated", "sidebar.json"),
    homePageFile: join(packageRoot, "home", "index.mdx"),
  };
}

/** A link to a repository file or folder on GitHub, on the development branch. */
export function repositoryLink(repositoryPath: string, isFolder: boolean): string {
  const view = isFolder ? "tree" : "blob";

  return `${REPOSITORY_URL}/${view}/${REPOSITORY_BRANCH}/${repositoryPath}`;
}
