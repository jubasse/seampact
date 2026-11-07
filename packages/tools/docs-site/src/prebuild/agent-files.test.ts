import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type AgentFiles, buildAgentFiles } from "./agent-files.ts";
import { sectionOf } from "./markdown-sections.ts";
import { MARKDOWN_TWIN_URL, siteLayoutFrom } from "./site-layout.ts";
import { STACK_FILES, stackFileName } from "./stack-files.ts";
import { estimateTokens, TOKEN_BUDGETS } from "./token-budget.ts";

const PACKAGE_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CONTRIBUTOR_MARKERS = [
  "md/adr/",
  "md/ir/",
  "md/decisions.md",
  "md/roadmap.md",
  "md/design-decisions.md",
];

// Building every page of docs/ takes several seconds on a loaded machine.
const BUILD_TIMEOUT_MILLISECONDS = 60_000;

let files: AgentFiles;

beforeAll(() => {
  files = buildAgentFiles(siteLayoutFrom(PACKAGE_ROOT));
}, BUILD_TIMEOUT_MILLISECONDS);

function textOf(name: string): string {
  const text = files.get(name);

  if (text === undefined) throw new Error(`${name} was not generated.`);

  return text;
}

/** The codes in the first column of the error table under one `##` heading. */
function refusalCodesOf(generateErrors: string, family: string): string[] {
  const section = sectionOf(generateErrors, family) ?? "";

  return [...section.matchAll(/^\| ((?:`[^`]+`(?:, )?)+) \|/gm)].flatMap((row) =>
    [...(row[1] ?? "").matchAll(/`([^`]+)`/g)].map((code) => code[1] ?? ""),
  );
}

function expectWithinBudget(name: string, budget: number): void {
  const tokens = estimateTokens(textOf(name));

  expect(
    tokens,
    `${name} is about ${tokens} tokens, over its budget of ${budget}`,
  ).toBeLessThanOrEqual(budget);
}

describe("agent files token budgets", () => {
  it("keeps llms.txt within its budget", () => {
    expectWithinBudget("llms.txt", TOKEN_BUDGETS.llmsIndex);
  });

  it("keeps every stack file within its budget", () => {
    for (const stack of STACK_FILES)
      expectWithinBudget(stackFileName(stack), TOKEN_BUDGETS.stackFile);
  });

  it("keeps llms-full.txt within its budget", () => {
    expectWithinBudget("llms-full.txt", TOKEN_BUDGETS.llmsFull);
  });
});

describe("agent files reachability", () => {
  it("serves every page llms.txt links", () => {
    const links = [...textOf("llms.txt").matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(
      (match) => match[1] ?? "",
    );
    const served = (url: string): boolean =>
      url.startsWith(MARKDOWN_TWIN_URL)
        ? files.has(`md/${url.slice(MARKDOWN_TWIN_URL.length)}`)
        : files.has(url.slice(url.lastIndexOf("/") + 1));
    const missing = links.filter((url) => !served(url));

    expect(missing, `llms.txt links files that are not generated: ${missing.join(", ")}`).toEqual(
      [],
    );
    expect(links.length).toBeGreaterThan(STACK_FILES.length);
  });

  it("links a stack file for every server and the clients", () => {
    for (const stack of STACK_FILES)
      expect(textOf("llms.txt")).toContain(`/${stackFileName(stack)})`);
  });

  it("leaves contributor pages out of every agent file", () => {
    const leaked = [...files.keys()].filter((name) =>
      CONTRIBUTOR_MARKERS.some((marker) => name.startsWith(marker)),
    );

    expect(leaked).toEqual([]);

    for (const [name, text] of files) {
      if (name.startsWith("md/")) continue;

      const mentioned = CONTRIBUTOR_MARKERS.filter((marker) =>
        text.includes(`${MARKDOWN_TWIN_URL}${marker.slice("md/".length)}`),
      );

      expect(mentioned, `${name} points at a contributor page`).toEqual([]);
    }
  });

  it("points every link of a twin at a twin, a stack file or an outside URL", () => {
    const dangling: string[] = [];

    for (const [name, text] of files) {
      if (!name.startsWith("md/")) continue;

      for (const match of text.matchAll(
        /\]\((https:\/\/jubasse\.github\.io\/seampact\/md\/[^)#]+)/g,
      )) {
        const target = `md/${(match[1] ?? "").slice(MARKDOWN_TWIN_URL.length)}`;

        if (!files.has(target)) dangling.push(`${name} -> ${target}`);
      }
    }

    expect(dangling).toEqual([]);
  });
});

describe("agent files content", () => {
  it("builds a stack file from the guide by heading, with its error table", () => {
    const fastapi = textOf("llms-fastapi.txt");

    expect(fastapi).toContain("## Write a handler");
    expect(fastapi).toContain("| Code | Cause and fix |");
  });

  it("keeps the links to other pages in a stack file and drops the ones to its own page", () => {
    const laravel = textOf("llms-laravel.txt");

    expect(laravel).toMatch(/\]\(https:\/\/jubasse\.github\.io\/seampact\/md\/[^)]+\.md/);
    expect(laravel).not.toContain("](#");
  });

  it("holds every refusal code a stack can meet in its file", () => {
    const generateErrors = textOf("md/troubleshooting/generate.md");

    for (const stack of STACK_FILES) {
      const file = textOf(stackFileName(stack));
      const missing = stack.troubleshootingFamilies
        .flatMap((family) => refusalCodesOf(generateErrors, family))
        .filter((code) => !file.includes(`\`${code}\``));

      expect(missing, `${stackFileName(stack)} lacks codes of its error tables`).toEqual([]);
    }

    expect(textOf("llms-nestjs.txt")).toContain("`identity.response.header.unsupported`");
    expect(textOf("llms-laravel.txt")).toContain("`principal.variants.unsupported`");
  });

  it("links no contributor page from the docs index twin or llms-full.txt", () => {
    for (const name of ["md/README.md", "llms-full.txt"]) {
      expect(textOf(name), `${name} links a contributor page`).not.toMatch(
        /\]\([^)]*\/(adr|ir)\/\)|\]\([^)]*\/(decisions|design-decisions|roadmap)\.md/,
      );
    }
  });

  it(
    "is deterministic",
    () => {
      const again = buildAgentFiles(siteLayoutFrom(PACKAGE_ROOT));

      expect([...again.entries()]).toEqual([...files.entries()]);
    },
    BUILD_TIMEOUT_MILLISECONDS,
  );
});
