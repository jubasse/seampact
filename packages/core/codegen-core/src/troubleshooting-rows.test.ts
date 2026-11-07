import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { GENERATE_TROUBLESHOOTING_SECTIONS, NOT_GENERATED_FIXES } from "./not-generated-fixes.js";

// Every code a Node target can print has a row in docs/troubleshooting, so that its docs URL leads to its fix.

const REPOSITORY_ROOT = resolve(import.meta.dirname, "../../../..");
const TROUBLESHOOTING_DIRECTORY = join(REPOSITORY_ROOT, "docs/troubleshooting");
const GENERATE_PAGE = "generate.md";
const UNSUPPORTED_SUFFIX = ".unsupported";

// The sources whose refusals reach `generate`: codegen-core and every Node target.
const REFUSING_SOURCE_DIRECTORIES = [
  join(REPOSITORY_ROOT, "packages/core/codegen-core/src"),
  ...readdirSync(join(REPOSITORY_ROOT, "packages/targets")).map((target) =>
    join(REPOSITORY_ROOT, "packages/targets", target, "src"),
  ),
];

// The validator libraries' own issue code, which the targets write into the generated code, not a refusal.
const GENERATED_CODE_ISSUE_CODES = new Set(["custom"]);

const LITERAL_CODE = /code: "([^"]+)"/g;
const INCONSISTENT_IR_CODE = /refuseInconsistentIr\(\s*"([^"]+)"/g;
const ROW_CODE = /`([^`]+)`/g;

interface TroubleshootingRow {
  readonly page: string;
  readonly section: string;
  readonly codes: readonly string[];
}

const rows = readdirSync(TROUBLESHOOTING_DIRECTORY)
  .filter((page) => page.endsWith(".md"))
  .flatMap((page) => rowsOf(page, readFileSync(join(TROUBLESHOOTING_DIRECTORY, page), "utf8")));

describe("the troubleshooting rows of the codes `generate` prints", () => {
  test.each(Object.entries(NOT_GENERATED_FIXES))(
    "the form %s has a row in its section of the generate page",
    (form, { section }) => {
      const sectionCodes = rows
        .filter((row) => row.page === GENERATE_PAGE && row.section === section)
        .flatMap((row) => row.codes);

      expect(sectionCodes).toContain(`${form}${UNSUPPORTED_SUFFIX}`);
    },
  );

  test("each code a Node target refuses with by name has a row", () => {
    const documented = rows.flatMap((row) => row.codes);
    const missing = emittedLiteralCodes().filter(
      (code) => !documented.some((row) => rowCodeMatches(row, code)),
    );

    expect(missing).toEqual([]);
  });

  // Every server's section also holds the native servers' own forms.
  test("each unsupported form in a Node section of the generate page is one a Node target refuses", () => {
    const nodeSections = new Set<string>(
      Object.values(GENERATE_TROUBLESHOOTING_SECTIONS).filter(
        (section) => section !== GENERATE_TROUBLESHOOTING_SECTIONS.everyServer,
      ),
    );
    const refused = new Set([
      ...Object.keys(NOT_GENERATED_FIXES).map((form) => `${form}${UNSUPPORTED_SUFFIX}`),
      ...emittedLiteralCodes(),
    ]);
    const stale = rows
      .filter((row) => row.page === GENERATE_PAGE && nodeSections.has(row.section))
      .flatMap((row) => row.codes)
      .filter((code) => code.endsWith(UNSUPPORTED_SUFFIX) && !refused.has(code));

    expect(stale).toEqual([]);
  });
});

// The codes of a page's table rows, by the anchor of the section that holds them.
function rowsOf(page: string, markdown: string): TroubleshootingRow[] {
  const found: TroubleshootingRow[] = [];
  let section = "";

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) section = headingAnchor(line.slice(3));

    if (!line.startsWith("| `")) continue;

    const firstCell = line.split("|")[1] ?? "";
    const codes = [...firstCell.matchAll(ROW_CODE)].map((match) => match[1] ?? "");

    found.push({ page, section, codes });
  }

  return found;
}

function headingAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9 -]/g, "")
    .replaceAll(" ", "-");
}

// A row code such as `options.<key>.invalid` stands for every code with one name in place of `<key>`.
function rowCodeMatches(rowCode: string, code: string): boolean {
  if (rowCode === code) return true;

  if (!rowCode.includes("<")) return false;

  const pattern = rowCode
    .split(/<[^>]+>/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^.]+");

  return new RegExp(`^${pattern}$`).test(code);
}

// The codes the refusing sources write out whole, not built from a form.
function emittedLiteralCodes(): string[] {
  const codes = REFUSING_SOURCE_DIRECTORIES.flatMap((directory) =>
    sourceFiles(directory).flatMap((file) => {
      const source = readFileSync(file, "utf8");

      return [...source.matchAll(LITERAL_CODE), ...source.matchAll(INCONSISTENT_IR_CODE)].map(
        (match) => match[1] ?? "",
      );
    }),
  );

  return [...new Set(codes)].filter((code) => !GENERATED_CODE_ISSUE_CODES.has(code)).sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter(
      (file) =>
        file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.includes("test-support"),
    )
    .map((file) => join(directory, file));
}
