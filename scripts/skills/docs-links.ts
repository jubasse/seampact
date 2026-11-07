// Rewrites the relative links of a docs/ page to the absolute site URLs, so a copied section still links to the page it names.

import { join, posix } from "node:path";
import {
  type LinkContext,
  resolveLinkTarget,
  siteRoute,
} from "../../packages/tools/docs-site/src/prebuild/link-target.ts";
import { SITE_URL } from "../../packages/tools/docs-site/src/prebuild/site-layout.ts";
import { listSourcePages } from "../../packages/tools/docs-site/src/prebuild/source-pages.ts";

const MARKDOWN_LINK = /(\]\()([^)\s]+)(\))/g;

export interface DocsLinkRewriter {
  rewrite(markdown: string, sourceDocsPath: string): string;
  /** The site URL of a docs page: `https://jubasse.github.io/seampact/backend/hono/`. */
  pageUrl(docsPath: string): string;
}

export function docsLinkRewriter(repositoryRoot: string): DocsLinkRewriter {
  const docsRoot = join(repositoryRoot, "docs");
  const pagesByDocsPath = listSourcePages(docsRoot);
  const indexedFolders = new Set(
    [...pagesByDocsPath.values()]
      .filter((page) => posix.basename(page.docsPath) === "README.md")
      .map((page) => posix.dirname(page.docsPath)),
  );

  const context: LinkContext = {
    repositoryRoot,
    pagesByDocsPath,
    indexedFolders,
    linkStyle: "site",
  };

  return {
    pageUrl(docsPath) {
      const page = pagesByDocsPath.get(docsPath);

      if (page === undefined) throw new Error(`docs/${docsPath} is not a published page.`);

      return absoluteUrl(siteRoute(page.slug));
    },

    rewrite(markdown, sourceDocsPath) {
      return markdown.replace(MARKDOWN_LINK, (whole, open: string, url: string, close: string) => {
        // An anchor alone names a heading of the source page, which a copied section may not hold.
        const linked = url.startsWith("#") ? `${posix.basename(sourceDocsPath)}${url}` : url;
        const target = resolveLinkTarget(linked, sourceDocsPath, context);

        if (target.kind === "broken") throw new Error(`${sourceDocsPath}: ${target.reason}`);

        if (target.kind === "unchanged") return whole;

        // Only the Markdown twin style drops a link; the skills use the site style.
        if (target.kind === "textOnly")
          throw new Error(`${sourceDocsPath}: ${url} has no site link to copy into a skill.`);

        return `${open}${absoluteUrl(target.url)}${close}`;
      });
    },
  };
}

function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}
