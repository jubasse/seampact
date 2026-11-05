import { readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { FOLDERS_LEFT_OUT } from "./site-layout.ts";

const MARKDOWN_EXTENSION = ".md";
const FOLDER_INDEX_NAME = "README.md";

/** One Markdown file of docs/ the site publishes, and the route it gets. */
export interface SourcePage {
  /** Path from docs/, with forward slashes: `backend/hono.md`. */
  docsPath: string;
  /** Route from the site base, without slashes around it: `backend/hono`, or `` for the home page. */
  slug: string;
  /** Path of the written page from the content folder: `backend/hono.md`, `index.md`. */
  contentPath: string;
}

/** Every published page of docs/, keyed by its docs path, in a stable order. */
export function listSourcePages(docsRoot: string): Map<string, SourcePage> {
  const pagesByDocsPath = new Map<string, SourcePage>();

  for (const docsPath of listMarkdownFiles(docsRoot, docsRoot).sort()) {
    pagesByDocsPath.set(docsPath, sourcePageFor(docsPath));
  }

  return pagesByDocsPath;
}

function listMarkdownFiles(docsRoot: string, folder: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const entryPath = join(folder, entry.name);
    const docsPath = relative(docsRoot, entryPath).split(sep).join(posix.sep);

    if (entry.isDirectory() && !isFolderLeftOut(docsPath))
      files.push(...listMarkdownFiles(docsRoot, entryPath));

    if (entry.isFile() && entry.name.endsWith(MARKDOWN_EXTENSION)) files.push(docsPath);
  }

  return files;
}

function isFolderLeftOut(docsPath: string): boolean {
  return (FOLDERS_LEFT_OUT as readonly string[]).includes(docsPath);
}

/** A folder's README is its index page: `getting-started/README.md` is served at `getting-started/`. */
export function sourcePageFor(docsPath: string): SourcePage {
  const folder = posix.dirname(docsPath) === "." ? "" : posix.dirname(docsPath);

  if (posix.basename(docsPath) === FOLDER_INDEX_NAME) {
    return { docsPath, slug: folder, contentPath: posix.join(folder, "index.md") };
  }

  return { docsPath, slug: docsPath.slice(0, -MARKDOWN_EXTENSION.length), contentPath: docsPath };
}

/** The docs path of a folder's index page, whether docs/ has it or the prebuild writes it. */
export function folderIndexDocsPath(folder: string): string {
  return posix.join(folder, FOLDER_INDEX_NAME);
}
