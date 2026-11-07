import { SITE_BASE } from "./site-layout.ts";

/** Pages for people who work on seampact, not for the people who use it. */
const CONTRIBUTOR_FOLDERS = ["adr", "ir"] as const;
const CONTRIBUTOR_FILES = ["decisions.md", "design-decisions.md", "roadmap.md"] as const;
const RELEASE_NOTES_FOLDER = "release-notes";

/** Doc ids the llms.txt files leave out: the contributor pages, which are not guides. */
export const LLMS_EXCLUDED_DOC_IDS = [
  ...CONTRIBUTOR_FOLDERS.map((folder) => `${folder}/**`),
  ...CONTRIBUTOR_FILES.map((file) => file.replace(/\.md$/, "")),
];

/** The route of the docs index page: the home page is site-only, so the index sits beside it. */
export const DOCS_INDEX_SLUG = "documentation";

/** A page that moved: GitHub readers keep its stub in docs/; the site redirects instead of serving it. */
export interface MovedPage {
  /** Path from docs/. */
  docsPath: string;
  /** Slug and anchor of the page that holds the content now. */
  target: string;
}

export const MOVED_PAGES: readonly MovedPage[] = [
  { docsPath: "configuration/checks.md", target: "features/check-in-ci/#set-the-levels" },
  {
    docsPath: "getting-started/02-first-contract.md",
    target: "getting-started/your-first-api/#2-write-the-contract",
  },
  {
    docsPath: "getting-started/03-generate-and-run.md",
    target: "getting-started/your-first-api/#3-generate-the-code",
  },
];

export function isContributorPage(docsPath: string): boolean {
  return (
    (CONTRIBUTOR_FILES as readonly string[]).includes(docsPath) ||
    CONTRIBUTOR_FOLDERS.some((folder) => docsPath.startsWith(`${folder}/`))
  );
}

export function isReleaseNotesPage(docsPath: string): boolean {
  return docsPath.startsWith(`${RELEASE_NOTES_FOLDER}/`);
}

export function movedPageFor(docsPath: string): MovedPage | undefined {
  return MOVED_PAGES.find((moved) => moved.docsPath === docsPath);
}

/** The frontmatter a page gets from where it sits: contributor pages stay out of search and reading order. */
export function placementFrontmatter(docsPath: string): Record<string, boolean> {
  if (isContributorPage(docsPath)) return { pagefind: false, prev: false, next: false };

  if (isReleaseNotesPage(docsPath)) return { prev: false, next: false };

  return {};
}

/** The Astro `redirects` entry of every moved page: old route to new route. */
export function movedPageRedirects(): Record<string, string> {
  return Object.fromEntries(
    MOVED_PAGES.map((moved) => [
      `/${moved.docsPath.replace(/\.md$/, "").replaceAll(".", "-")}`,
      `${SITE_BASE}${moved.target}`,
    ]),
  );
}
