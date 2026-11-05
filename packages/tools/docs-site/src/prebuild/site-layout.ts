import { join } from "node:path";

/** Where the site lives on GitHub Pages and where links out of the site point. */
export const SITE_URL = "https://jubasse.github.io";
export const SITE_BASE = "/seampact/";
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
}

export function siteLayoutFrom(packageRoot: string): SiteLayout {
  const repositoryRoot = join(packageRoot, "..", "..", "..");

  return {
    repositoryRoot,
    docsRoot: join(repositoryRoot, "docs"),
    contentRoot: join(packageRoot, "site", "content", "docs"),
    sidebarFile: join(packageRoot, "site", "generated", "sidebar.json"),
  };
}

/** A link to a repository file or folder on GitHub, on the development branch. */
export function repositoryLink(repositoryPath: string, isFolder: boolean): string {
  const view = isFolder ? "tree" : "blob";

  return `${REPOSITORY_URL}/${view}/${REPOSITORY_BRANCH}/${repositoryPath}`;
}
