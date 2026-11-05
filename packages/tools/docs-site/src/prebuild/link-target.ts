import { existsSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { repositoryLink, SITE_BASE } from "./site-layout.ts";
import type { SourcePage } from "./source-pages.ts";

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const DOCS_FOLDER_PREFIX = "docs/";

/** What a link of docs/ becomes on the site. */
export type LinkTarget =
  | { kind: "unchanged" }
  | { kind: "rewritten"; url: string }
  | { kind: "broken"; reason: string };

/** What the prebuild knows when it resolves a link. */
export interface LinkContext {
  repositoryRoot: string;
  pagesByDocsPath: ReadonlyMap<string, SourcePage>;
  /** The docs/ folders served at their own route, with a README or a written index page. */
  indexedFolders: ReadonlySet<string>;
}

/**
 * A relative link to a published page becomes its site route, anchor kept; a link to any other
 * repository file or folder becomes its GitHub link on the development branch. External links,
 * in-page anchors and links with a scheme are kept as they are.
 */
export function resolveLinkTarget(
  url: string,
  sourceDocsPath: string,
  context: LinkContext,
): LinkTarget {
  if (url === "" || url.startsWith("#") || url.startsWith("//") || URL_SCHEME_PATTERN.test(url)) {
    return { kind: "unchanged" };
  }

  if (url.startsWith("/")) {
    return {
      kind: "broken",
      reason: `"${url}" starts at the server root; write it relative to the page`,
    };
  }

  const hashStart = url.indexOf("#");
  const linkedPath = decodeURIComponent(hashStart === -1 ? url : url.slice(0, hashStart));
  const hash = hashStart === -1 ? "" : url.slice(hashStart);
  const sourceFolder = posix.dirname(`${DOCS_FOLDER_PREFIX}${sourceDocsPath}`);
  const repositoryPath = posix.normalize(posix.join(sourceFolder, linkedPath)).replace(/\/$/, "");

  if (repositoryPath === ".." || repositoryPath.startsWith("../")) {
    return { kind: "broken", reason: `"${url}" points outside the repository` };
  }

  const absolutePath = join(context.repositoryRoot, repositoryPath);

  if (!existsSync(absolutePath))
    return { kind: "broken", reason: `"${url}" points to ${repositoryPath}, which does not exist` };

  const isFolder = statSync(absolutePath).isDirectory();
  const siteSlug = siteSlugFor(repositoryPath, isFolder, context);

  if (siteSlug !== undefined) return { kind: "rewritten", url: `${siteRoute(siteSlug)}${hash}` };

  return { kind: "rewritten", url: `${repositoryLink(repositoryPath, isFolder)}${hash}` };
}

function siteSlugFor(
  repositoryPath: string,
  isFolder: boolean,
  context: LinkContext,
): string | undefined {
  if (repositoryPath === "docs") return "";

  if (!repositoryPath.startsWith(DOCS_FOLDER_PREFIX)) return undefined;

  const docsPath = repositoryPath.slice(DOCS_FOLDER_PREFIX.length);

  if (isFolder) return context.indexedFolders.has(docsPath) ? docsPath : undefined;

  return context.pagesByDocsPath.get(docsPath)?.slug;
}

/** The absolute route of a page under the site base: `/seampact/backend/hono/`. */
export function siteRoute(slug: string): string {
  return slug === "" ? SITE_BASE : `${SITE_BASE}${slug}/`;
}
