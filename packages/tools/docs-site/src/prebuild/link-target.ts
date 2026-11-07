import { existsSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { DOCS_INDEX_SLUG, isContributorPage, movedPageFor } from "./page-policy.ts";
import { MARKDOWN_TWIN_URL, repositoryLink, SITE_BASE } from "./site-layout.ts";
import type { SourcePage } from "./source-pages.ts";

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const DOCS_FOLDER_PREFIX = "docs/";

/** What a link of docs/ becomes on the site. */
export type LinkTarget =
  | { kind: "unchanged" }
  | { kind: "rewritten"; url: string }
  /** Only for the markdown twins: the link goes, its text stays (a page for contributors). */
  | { kind: "textOnly" }
  | { kind: "broken"; reason: string };

/** Where the links of a page point: the site routes, or the raw Markdown twins for agents. */
export type LinkStyle = "site" | "markdownTwin";

/** What the prebuild knows when it resolves a link. */
export interface LinkContext {
  repositoryRoot: string;
  pagesByDocsPath: ReadonlyMap<string, SourcePage>;
  /** The docs/ folders served at their own route, with a README or a written index page. */
  indexedFolders: ReadonlySet<string>;
  linkStyle: LinkStyle;
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
  const rawPath = hashStart === -1 ? url : url.slice(0, hashStart);
  const linkedPath = decodeLinkedPath(rawPath);

  if (linkedPath === undefined) {
    return {
      kind: "broken",
      reason: `"${url}" has a malformed percent escape; fix or remove the %`,
    };
  }

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
  const moved = repositoryPath.startsWith(DOCS_FOLDER_PREFIX)
    ? movedPageFor(repositoryPath.slice(DOCS_FOLDER_PREFIX.length))
    : undefined;

  // A moved page is not served: a link to it goes straight to the page that holds the content.
  if (moved !== undefined) {
    return {
      kind: "rewritten",
      url:
        context.linkStyle === "markdownTwin"
          ? movedPageTwinUrl(moved.target, hash)
          : movedPageUrl(moved.target, hash),
    };
  }

  if (context.linkStyle === "markdownTwin") {
    if (isContributorTarget(repositoryPath, isFolder)) return { kind: "textOnly" };

    const twinPath = markdownTwinPathFor(repositoryPath, isFolder, context);

    if (twinPath !== undefined)
      return { kind: "rewritten", url: `${MARKDOWN_TWIN_URL}${twinPath}${hash}` };

    return { kind: "rewritten", url: `${repositoryLink(repositoryPath, isFolder)}${hash}` };
  }

  const siteSlug = siteSlugFor(repositoryPath, isFolder, context);

  if (siteSlug !== undefined) return { kind: "rewritten", url: `${siteRoute(siteSlug)}${hash}` };

  return { kind: "rewritten", url: `${repositoryLink(repositoryPath, isFolder)}${hash}` };
}

function decodeLinkedPath(rawPath: string): string | undefined {
  try {
    return decodeURIComponent(rawPath);
  } catch (error) {
    if (error instanceof URIError) return undefined;

    throw error;
  }
}

function siteSlugFor(
  repositoryPath: string,
  isFolder: boolean,
  context: LinkContext,
): string | undefined {
  if (repositoryPath === "docs") return DOCS_INDEX_SLUG;

  if (!repositoryPath.startsWith(DOCS_FOLDER_PREFIX)) return undefined;

  const docsPath = repositoryPath.slice(DOCS_FOLDER_PREFIX.length);

  if (isFolder) return context.indexedFolders.has(docsPath) ? docsPath : undefined;

  return context.pagesByDocsPath.get(docsPath)?.slug;
}

function isContributorTarget(repositoryPath: string, isFolder: boolean): boolean {
  if (!repositoryPath.startsWith(DOCS_FOLDER_PREFIX)) return false;

  const docsPath = repositoryPath.slice(DOCS_FOLDER_PREFIX.length);

  return isContributorPage(isFolder ? `${docsPath}/` : docsPath);
}

/**
 * The twin path of a published user page or folder index. A folder
 * without a README is written as `<folder>/index.md`.
 */
function markdownTwinPathFor(
  repositoryPath: string,
  isFolder: boolean,
  context: LinkContext,
): string | undefined {
  if (repositoryPath === "docs") return "README.md";

  if (!repositoryPath.startsWith(DOCS_FOLDER_PREFIX)) return undefined;

  const docsPath = repositoryPath.slice(DOCS_FOLDER_PREFIX.length);

  if (!isFolder) return context.pagesByDocsPath.has(docsPath) ? docsPath : undefined;

  if (!context.indexedFolders.has(docsPath)) return undefined;

  const readme = posix.join(docsPath, "README.md");

  return context.pagesByDocsPath.has(readme) ? readme : posix.join(docsPath, "index.md");
}

/** The absolute route of a page under the site base: `/seampact/backend/hono/`. */
export function siteRoute(slug: string): string {
  return slug === "" ? SITE_BASE : `${SITE_BASE}${slug}/`;
}

/** The route of a moved page's target; an anchor the link wrote wins over the target's own. */
function movedPageUrl(target: string, linkHash: string): string {
  const targetWithoutHash = target.replace(/#.*$/, "");

  return `${SITE_BASE}${linkHash === "" ? target : `${targetWithoutHash}${linkHash}`}`;
}

/** The twin of a moved page's target; an anchor the link wrote wins over the target's own. */
function movedPageTwinUrl(target: string, linkHash: string): string {
  const targetPath = target.replace(/#.*$/, "").replace(/\/$/, "");
  const targetHash = target.slice(target.indexOf("#") === -1 ? target.length : target.indexOf("#"));

  return `${MARKDOWN_TWIN_URL}${targetPath}.md${linkHash === "" ? targetHash : linkHash}`;
}
