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
  "docs/configuration/checks.md",
  "docs/getting-started/README.md",
  "docs/getting-started/01-install.md",
  "docs/grammar/07-routes.md",
  "docs/adr/0001-x.md",
  "docs/decisions.md",
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
    linkStyle: "site",
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
        "[grammar](/seampact/grammar/), [home](/seampact/documentation/), [here](#top) and [ref][install].",
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

  it("refuses a relative image and a relative raw HTML reference, keeps absolute ones", () => {
    const page = transformPage(
      '# T\n\n![a](img/a.png)\n\n<img src="b.png">\n\n![c](https://example.com/c.png)\n\n<a href="#x">x</a>\n',
      "backend/hono.md",
      context,
    );

    expect(page.brokenLinks.map((link) => link.line)).toEqual([3, 5]);
    expect(page.brokenLinks[0]?.reason).toContain("img/a.png");
    expect(page.brokenLinks[1]?.reason).toContain("b.png");
  });

  it("names the page and the link for a malformed percent escape", () => {
    const page = transformPage("# T\n\n[x](bad%zz.md)\n", "backend/hono.md", context);

    expect(page.brokenLinks).toHaveLength(1);
    expect(page.brokenLinks[0]?.reason).toContain("bad%zz.md");
  });

  it("moves the headings up with a title that opened below h1", () => {
    const page = transformPage(
      "### 7. Routes\n\nText.\n\n#### Verbs\n\n##### Detail\n",
      "grammar/07-routes.md",
      context,
    );

    expect(bodyOf(page.markdown)).toBe("Text.\n\n## Verbs\n\n### Detail\n");
  });

  it("describes a page by its first real sentence, never a status line, and never twice", () => {
    const source =
      "# ADR 1: T\n\nStatus: accepted\n\nFirst sentence here. Second one.\n\nOther paragraph.\n";
    const first = transformPage(source, "adr/0001-t.md", context);
    const second = transformPage(source, "adr/0002-t.md", context, {
      takenDescriptions: new Set([first.description ?? ""]),
    });

    expect(first.description).toBe("First sentence here. Second one.");
    expect(second.description).toBe("Other paragraph.");
  });

  it("keeps contributor pages out of search and reading order, and sends a moved page's links to its target", () => {
    const page = transformPage(
      "# D\n\nSee [old](../configuration/checks.md).\n",
      "adr/0001-t.md",
      context,
    );

    expect(page.markdown).toContain("pagefind: false");
    expect(page.markdown).toContain("next: false");
    expect(page.markdown).toContain("(/seampact/features/check-in-ci/#set-the-levels)");
  });
});

describe("transformPage for markdown twins", () => {
  const twinContext = (): LinkContext => ({ ...context, linkStyle: "markdownTwin" });

  it("points page, folder, moved page and docs root links at twins, anchors kept", () => {
    const source = [
      "# Hono",
      "",
      "[Install](../getting-started/01-install.md#node), [start](../getting-started/README.md),",
      "[grammar](../grammar/), [home](../README.md), [checks](../configuration/checks.md#levels).",
      "",
    ].join("\n");

    const body = transformPage(source, "backend/hono.md", twinContext()).body;

    expect(body).toContain(
      "(https://jubasse.github.io/seampact/md/getting-started/01-install.md#node)",
    );
    expect(body).toContain("(https://jubasse.github.io/seampact/md/getting-started/README.md)");
    expect(body).toContain("(https://jubasse.github.io/seampact/md/grammar/index.md)");
    expect(body).toContain("(https://jubasse.github.io/seampact/md/README.md)");
    expect(body).toContain(
      "(https://jubasse.github.io/seampact/md/features/check-in-ci.md#levels)",
    );
  });

  it("keeps the text of a link to a contributor page and drops the link", () => {
    const source = "# Hono\n\nSee the [ADRs](../adr/) and [decisions](../decisions.md).\n";
    const body = transformPage(source, "backend/hono.md", twinContext()).body;

    expect(body).toBe("See the ADRs and decisions.\n");
  });
});
