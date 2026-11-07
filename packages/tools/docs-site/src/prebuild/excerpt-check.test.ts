import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPageExcerpts,
  listPageExcerpts,
  missingExcerptLines,
  type PageExcerpt,
} from "./excerpt-check.ts";

const REPOSITORY_ROOT = join(import.meta.dirname, "../../../../..");
const DOCS_ROOT = join(REPOSITORY_ROOT, "docs");

const GOLDEN = [
  "export const A = z.object({",
  "  title: z.string(),",
  "  effort: z.int(),",
  "});",
  "",
].join("\n");

function fenceOf(...lines: string[]): string {
  return ["<!-- excerpt: golden.ts -->", "```ts", ...lines, "```", ""].join("\n");
}

function onlyExcerptOf(lines: string[]): PageExcerpt {
  const [excerpt, ...others] = listPageExcerpts(fenceOf(...lines), "page.md");

  if (excerpt === undefined || others.length > 0) throw new Error("expected exactly one excerpt");

  return excerpt;
}

describe("excerpt check", () => {
  it("reads the golden path and the lines of the fence after a marker", () => {
    const excerpts = listPageExcerpts(fenceOf("export const A = z.object({", "});"), "page.md");

    expect(excerpts).toEqual([
      { goldenPath: "golden.ts", lines: ["export const A = z.object({", "});"] },
    ]);
  });

  it("accepts lines in order, with an elision line standing for skipped lines", () => {
    const excerpt = onlyExcerptOf(["export const A = z.object({", "  ...", "});"]);

    expect(missingExcerptLines(excerpt, GOLDEN)).toEqual([]);
  });

  it("names the first line the golden does not show in order", () => {
    const excerpt = onlyExcerptOf(["  effort: z.int(),", "  title: z.string(),"]);

    expect(missingExcerptLines(excerpt, GOLDEN)).toEqual(["  title: z.string(),"]);
  });

  it("refuses a marker with no code fence after it", () => {
    expect(() => listPageExcerpts("<!-- excerpt: golden.ts -->\n\nText.\n", "page.md")).toThrow(
      /not followed by a code fence/,
    );
  });
});

function listMarkdownPages(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(folder, entry.name);

    if (entry.isDirectory()) return listMarkdownPages(entryPath);

    return entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

describe("excerpts in docs/", () => {
  it("every excerpt appears, in order, in the golden file it names", () => {
    const problems = listMarkdownPages(DOCS_ROOT).flatMap((page) =>
      checkPageExcerpts(
        readFileSync(page, "utf8"),
        relative(REPOSITORY_ROOT, page),
        REPOSITORY_ROOT,
      ),
    );

    expect(problems).toEqual([]);
  });
});
