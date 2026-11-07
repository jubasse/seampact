import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { docsLinkRewriter } from "./docs-links.ts";
import { hasSection, pageBody, sectionOf } from "./markdown-sections.ts";
import {
  CLI_SKILLS_DIRECTORY,
  expectedSkillTree,
  GENERATE_COMMAND,
  SKILLS_DIRECTORY,
  treeProblems,
} from "./skill-tree.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test.each([SKILLS_DIRECTORY, CLI_SKILLS_DIRECTORY])(
  "%s holds the SKILL.md files and the references generated from docs/",
  (directory) => {
    const problems = treeProblems(expectedSkillTree(REPO_ROOT), REPO_ROOT, directory);

    expect(problems, `run \`${GENERATE_COMMAND}\``).toEqual([]);
  },
);

test("a section runs to the next heading of the same level and ignores headings in code fences", () => {
  const markdown =
    "# T\n\nintro\n\n## A\n\na\n\n```sh\n# not a heading\n```\n\n### A1\n\nsub\n\n## B\n\nb\n";

  expect(sectionOf(markdown, "A")).toBe(
    "## A\n\na\n\n```sh\n# not a heading\n```\n\n### A1\n\nsub",
  );
  expect(hasSection(markdown, "not a heading")).toBe(false);
  expect(pageBody(markdown).startsWith("intro")).toBe(true);
  expect(() => sectionOf(markdown, "Missing")).toThrow("No heading 'Missing'");
});

test("a copied link becomes the absolute site URL, and an in-page anchor names the source page", () => {
  const rewriter = docsLinkRewriter(REPO_ROOT);
  const rewritten = rewriter.rewrite(
    "[a](../contract/05-lists.md#more-styles) [b](#versions) [c](https://example.com/x)",
    "backend/fastapi.md",
  );

  expect(rewritten).toBe(
    "[a](https://jubasse.github.io/seampact/contract/05-lists/#more-styles) [b](https://jubasse.github.io/seampact/backend/fastapi/#versions) [c](https://example.com/x)",
  );
});
