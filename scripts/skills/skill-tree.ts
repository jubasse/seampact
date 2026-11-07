// The skills folder as it must be: the hand-written SKILL.md files and AGENTS block template, plus the references
// generated from docs/, written at the repository root and mirrored into the CLI package, which ships them.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { docsLinkRewriter } from "./docs-links.ts";
import { hasSection, pageBody, pageTitle, sectionOf } from "./markdown-sections.ts";
import { type ReferenceFile, type ReferenceSource, SKILL_REFERENCES } from "./references.ts";

export const SKILLS_DIRECTORY = "skills";
export const CLI_SKILLS_DIRECTORY = "packages/core/cli/skills";
export const AGENTS_BLOCK_FILE = "agents-block.md";
export const SKILL_FILE = "SKILL.md";
export const GENERATE_COMMAND = "node scripts/skills/cli.ts --write";

/** File text by path from the skills folder, `seampact-setup/references/install.md`. */
export type SkillTree = ReadonlyMap<string, string>;

export function expectedSkillTree(repositoryRoot: string): SkillTree {
  const tree = new Map<string, string>();
  const rewriter = docsLinkRewriter(repositoryRoot);
  const skillsRoot = join(repositoryRoot, SKILLS_DIRECTORY);

  tree.set(AGENTS_BLOCK_FILE, readFileSync(join(skillsRoot, AGENTS_BLOCK_FILE), "utf8"));

  for (const { skill, files } of SKILL_REFERENCES) {
    tree.set(`${skill}/${SKILL_FILE}`, readFileSync(join(skillsRoot, skill, SKILL_FILE), "utf8"));

    for (const file of files) {
      tree.set(`${skill}/${file.path}`, referenceText(repositoryRoot, file, rewriter));
    }
  }

  return tree;
}

function referenceText(
  repositoryRoot: string,
  file: ReferenceFile,
  rewriter: ReturnType<typeof docsLinkRewriter>,
): string {
  const sources = file.sources.map((source) => sourceText(repositoryRoot, source, rewriter));
  const origin = file.sources.map((source) => `docs/${source.docsPath}`).join(", ");

  return `<!-- Generated from ${origin} by \`${GENERATE_COMMAND}\`. Edit the docs, not this file. -->\n\n${sources.join("\n\n")}\n`;
}

function sourceText(
  repositoryRoot: string,
  source: ReferenceSource,
  rewriter: ReturnType<typeof docsLinkRewriter>,
): string {
  const markdown = readFileSync(join(repositoryRoot, "docs", source.docsPath), "utf8");
  const title = pageTitle(markdown);
  const wanted = [
    ...(source.sections ?? []),
    ...(source.optionalSections ?? []).filter((section) => hasSection(markdown, section)),
  ];
  const body =
    source.sections === undefined
      ? pageBody(markdown)
      : wanted.map((section) => sectionOf(markdown, section)).join("\n\n");

  return `# ${title}\n\nPage: ${rewriter.pageUrl(source.docsPath)}\n\n${rewriter.rewrite(body, source.docsPath)}`;
}

/** Every file under `directory`, as paths from it with forward slashes. */
export function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

/** One line per difference between a skills folder on disk and the tree it must hold. */
export function treeProblems(tree: SkillTree, repositoryRoot: string, directory: string): string[] {
  const root = join(repositoryRoot, directory);
  const onDisk = new Set(filesUnder(root));
  const problems: string[] = [];

  for (const [path, text] of tree) {
    if (!onDisk.has(path)) problems.push(`${directory}/${path} is missing`);
    else if (readFileSync(join(root, path), "utf8") !== text)
      problems.push(`${directory}/${path} differs from its source`);
  }

  for (const path of onDisk)
    if (!tree.has(path)) problems.push(`${directory}/${path} is not generated: remove it`);

  return problems;
}

/** Writes the tree at the repository root and in the CLI package, removing the files it no longer holds. */
export function writeSkillTree(tree: SkillTree, repositoryRoot: string): void {
  for (const directory of [SKILLS_DIRECTORY, CLI_SKILLS_DIRECTORY]) {
    const root = join(repositoryRoot, directory);

    for (const path of filesUnder(root)) if (!tree.has(path)) rmSync(join(root, path));

    for (const [path, text] of tree) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
  }
}
