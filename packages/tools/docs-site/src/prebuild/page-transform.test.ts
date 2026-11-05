import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LinkContext } from "./link-target.ts";
import { transformPage } from "./page-transform.ts";
import { listSourcePages } from "./source-pages.ts";

const REPOSITORY_FILES = [
  "README.md",
  "packages/core/cli/src/index.ts",
  "docs/README.md",
  "docs/backend/hono.md",
  "docs/getting-started/README.md",
  "docs/getting-started/01-install.md",
  "docs/grammar/07-routes.md",
];

let repositoryRoot = "";
let context: LinkContext;

beforeAll(() => {
  repositoryRoot = mkdtempSync(join(tmpdir(), "docs-site-"));

  for (const file of REPOSITORY_FILES) {
    mkdirSync(dirname(join(repositoryRoot, file)), { recursive: true });
    writeFileSync(join(repositoryRoot, file), "# Page\n");
  }

  const pagesByDocsPath = listSourcePages(join(repositoryRoot, "docs"));

  context = {
    repositoryRoot,
    pagesByDocsPath,
    indexedFolders: new Set(["backend", "getting-started", "grammar"]),
  };
});

afterAll(() => {
  rmSync(repositoryRoot, { recursive: true, force: true });
});

function bodyOf(markdown: string): string {
  return markdown.slice(markdown.indexOf("\n---\n\n") + "\n---\n\n".length);
}

describe("transformPage", () => {
  it("takes the title from the opening heading of any level and removes it from the body", () => {
    const page = transformPage(
      "### 7. Routes\n\nA route has a `method`.\n",
      "grammar/07-routes.md",
      context,
    );

    expect(page.title).toBe("7. Routes");
    expect(page.markdown).toContain('title: "7. Routes"\ndescription: "A route has a method."');
    expect(bodyOf(page.markdown)).toBe("A route has a `method`.\n");
  });

  it("refuses a page that does not open with a heading", () => {
    expect(() => transformPage("Text first.\n", "backend/hono.md", context)).toThrow(
      /does not open with a heading/,
    );
  });

  it("rewrites page, folder and anchor links to site routes", () => {
    const source = [
      "# Hono",
      "",
      "[Install](../getting-started/01-install.md#node), [start](../getting-started/README.md),",
      "[grammar](../grammar/), [home](../README.md), [here](#top) and [ref][install].",
      "",
      "[install]: <../getting-started/01-install.md>",
      "",
    ].join("\n");

    const body = bodyOf(transformPage(source, "backend/hono.md", context).markdown);

    expect(body).toBe(
      [
        "[Install](/seampact/getting-started/01-install/#node), [start](/seampact/getting-started/),",
        "[grammar](/seampact/grammar/), [home](/seampact/), [here](#top) and [ref][install].",
        "",
        "[install]: /seampact/getting-started/01-install/",
        "",
      ].join("\n"),
    );
  });

  it("points links outside docs/ to GitHub on the development branch", () => {
    const source =
      "# Hono\n\nSee [the README](../../README.md#supported-stacks) and [the cli](../../packages/core/cli/src).\n";
    const body = bodyOf(transformPage(source, "backend/hono.md", context).markdown);

    expect(body).toContain(
      "(https://github.com/jubasse/seampact/blob/develop/README.md#supported-stacks)",
    );
    expect(body).toContain(
      "(https://github.com/jubasse/seampact/tree/develop/packages/core/cli/src)",
    );
  });

  it("leaves links inside code untouched", () => {
    const source = "# Hono\n\n```md\n[x](../backend/hono.md)\n```\n\n`[y](missing.md)`\n";

    expect(bodyOf(transformPage(source, "backend/hono.md", context).markdown)).toBe(
      "```md\n[x](../backend/hono.md)\n```\n\n`[y](missing.md)`\n",
    );
  });

  it("reports each link to a missing file with its line", () => {
    const page = transformPage("# Hono\n\nSee [gone](missing.md).\n", "backend/hono.md", context);

    expect(page.brokenLinks).toEqual([
      {
        docsPath: "backend/hono.md",
        line: 3,
        reason: '"missing.md" points to docs/backend/missing.md, which does not exist',
      },
    ]);
  });
});
