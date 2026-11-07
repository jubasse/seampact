import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import type { LinkContext } from "./link-target.ts";
import { buildLlmsIndex } from "./llms-index.ts";
import { parseMarkdown } from "./markdown-tree.ts";
import { isContributorPage } from "./page-policy.ts";
import { transformPage } from "./page-transform.ts";
import { MARKDOWN_TWIN_URL, type SiteLayout } from "./site-layout.ts";
import { folderIndexDocsPath, listSourcePages } from "./source-pages.ts";
import { buildStackFile, STACK_FILES, stackFileName } from "./stack-files.ts";

const INDEX_DOCS_PATH = "README.md";
const MARKDOWN_TWIN_FOLDER = "md";
const FULL_FILE_NAME = "llms-full.txt";
const INDEX_FILE_NAME = "llms.txt";

/** The agent files, by path from the site's static folder. */
export type AgentFiles = Map<string, string>;

/** A user page as an agent reads it. */
interface UserPage {
  docsPath: string;
  title: string;
  /** The title as a level-1 heading, then the body with its links pointing at twins. */
  markdown: string;
}

/**
 * Builds `llms.txt`, a raw Markdown twin of every user page, one file per stack and `llms-full.txt`.
 * Contributor pages (ADRs, IR, decisions, roadmap) are in none of them.
 */
export function buildAgentFiles(layout: SiteLayout): AgentFiles {
  const pagesByDocsPath = listSourcePages(layout.docsRoot);
  const folders = new Set(
    [...pagesByDocsPath.values()]
      .map((page) => posix.dirname(page.slug))
      .filter((folder) => folder !== "."),
  );
  const context: LinkContext = {
    repositoryRoot: layout.repositoryRoot,
    pagesByDocsPath,
    indexedFolders: folders,
    toMarkdownTwins: true,
  };
  const userPages = [...pagesByDocsPath.keys()]
    .filter((docsPath) => !isContributorPage(docsPath))
    .map((docsPath) => userPageOf(layout, docsPath, context));
  const twins = new Map(userPages.map((page) => [page.docsPath, page.markdown]));
  const files: AgentFiles = new Map();

  for (const page of userPages)
    files.set(posix.join(MARKDOWN_TWIN_FOLDER, page.docsPath), page.markdown);

  for (const [folderIndexPath, markdown] of folderIndexTwins(
    folders,
    pagesByDocsPath.keys(),
    userPages,
  )) {
    files.set(posix.join(MARKDOWN_TWIN_FOLDER, folderIndexPath), markdown);
  }

  const indexTree = parseMarkdown(readFileSync(join(layout.docsRoot, INDEX_DOCS_PATH), "utf8"));

  files.set(INDEX_FILE_NAME, buildLlmsIndex(indexTree, context, STACK_FILES));
  files.set(FULL_FILE_NAME, fullFile(userPages));

  for (const stack of STACK_FILES) files.set(stackFileName(stack), buildStackFile(stack, twins));

  return files;
}

function userPageOf(layout: SiteLayout, docsPath: string, context: LinkContext): UserPage {
  const page = transformPage(
    readFileSync(join(layout.docsRoot, docsPath), "utf8"),
    docsPath,
    context,
  );

  if (page.brokenLinks.length > 0) {
    const first = page.brokenLinks[0];

    throw new Error(`docs/${docsPath}:${first?.line}: ${first?.reason}.`);
  }

  return { docsPath, title: page.title, markdown: `# ${page.title}\n\n${page.body}` };
}

/** A folder without a README gets `<folder>/index.md`, which lists its user pages, so a link to the folder resolves. */
function folderIndexTwins(
  folders: ReadonlySet<string>,
  docsPaths: Iterable<string>,
  userPages: UserPage[],
): Map<string, string> {
  const withReadme = new Set([...docsPaths]);
  const indexes = new Map<string, string>();

  for (const folder of [...folders].sort()) {
    if (withReadme.has(folderIndexDocsPath(folder)) || isContributorPage(`${folder}/`)) continue;

    const lines = userPages
      .filter((page) => posix.dirname(page.docsPath) === folder)
      .map((page) => `- [${page.title}](${MARKDOWN_TWIN_URL}${page.docsPath})`);

    indexes.set(posix.join(folder, "index.md"), `# ${folder}\n\n${lines.join("\n")}\n`);
  }

  return indexes;
}

/** Every user page in one file, each opened by a line that names its source. */
function fullFile(userPages: UserPage[]): string {
  return `${userPages.map((page) => `Source: ${MARKDOWN_TWIN_URL}${page.docsPath}\n\n${page.markdown}`).join("\n\n")}\n`;
}

/** Replaces the generated agent files of the static folder; the committed files beside them stay. */
export function writeAgentFiles(layout: SiteLayout, files: AgentFiles): void {
  rmSync(join(layout.publicRoot, MARKDOWN_TWIN_FOLDER), { recursive: true, force: true });

  for (const name of readdirSync(layout.publicRoot)) {
    if (name.startsWith("llms") && name.endsWith(".txt")) rmSync(join(layout.publicRoot, name));
  }

  for (const [path, text] of files) {
    const file = join(layout.publicRoot, path);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}
