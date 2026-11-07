import type { Link, List, Root } from "mdast";
import { visit } from "unist-util-visit";
import { type LinkContext, resolveLinkTarget } from "./link-target.ts";
import { plainText } from "./markdown-tree.ts";
import { MARKDOWN_TWIN_URL, SITE_BASE, SITE_URL } from "./site-layout.ts";
import { type StackFile, stackFileUrl } from "./stack-files.ts";

const INDEX_DOCS_PATH = "README.md";

/** Sections of the docs index that are for contributors, not users. */
const SECTIONS_LEFT_OUT = new Set(["Design"]);

/** Entries that only list the pages below them; the index already lists those pages. */
const FOLDER_INDEX_PAGES_LEFT_OUT = new Set([
  `${MARKDOWN_TWIN_URL}contract/README.md`,
  `${MARKDOWN_TWIN_URL}release-notes/README.md`,
]);

const SUMMARY =
  "seampact turns one YAML contract into the server code, the typed clients and the OpenAPI document of an HTTP API, for NestJS, Express, Fastify, Hono, AdonisJS, Spring Boot, Laravel, Symfony, FastAPI, Django REST Framework and Django Ninja. You write the handlers; the generated code checks every request and reply.";

const START_LINES = [
  "Change the API in the contract (`contract/*.yaml`), never in the generated folder (`outDir` in `seampact.config.yaml`).",
  "After each change run generate, then check, then the compiler of your language; the command differs per stack, see Commands per stack.",
  "Every error starts with a code and ends with `Fix:`: apply it, and find the code's prefix under Troubleshooting.",
];

const LINKS_NOTE =
  "Each link is the raw Markdown of one page; read the page your task needs. The stack files hold one stack's guide, validators, contract essentials and error table in one file.";

interface IndexEntry {
  title: string;
  url: string;
  description: string;
}

/** The `llms.txt` of the site (llmstxt.org): what seampact is, how to start, then one line per user page. */
export function buildLlmsIndex(
  indexTree: Root,
  context: LinkContext,
  stacks: readonly StackFile[],
): string {
  const taken = new Set<string>();
  const sections: string[] = [];

  for (const section of readSections(indexTree)) {
    if (SECTIONS_LEFT_OUT.has(section.label)) continue;

    const entries = section.items
      .map((item) => entryOf(item, context))
      .filter((entry): entry is IndexEntry => entry !== undefined)
      .filter((entry) => !FOLDER_INDEX_PAGES_LEFT_OUT.has(entry.url) && claim(taken, entry.url));

    if (entries.length > 0)
      sections.push(`## ${section.label}\n${entries.map(entryLine).join("\n")}`);
  }

  const stackLines = stacks.map((stack) => `- [${stack.title}](${stackFileUrl(stack)})`);
  const head = [
    "# seampact",
    `> ${SUMMARY}`,
    START_LINES.map((line) => `- ${line}`).join("\n"),
    LINKS_NOTE,
  ];

  return `${[...head, ...sections, `## Stack files\n${stackLines.join("\n")}`, optionalSection()].join("\n\n")}\n`;
}

function optionalSection(): string {
  return `## Optional\n- [All user pages in one file](${SITE_URL}${SITE_BASE}llms-full.txt): every user page.`;
}

function claim(taken: Set<string>, url: string): boolean {
  if (taken.has(url)) return false;

  taken.add(url);

  return true;
}

function entryLine(entry: IndexEntry): string {
  const description = entry.description === "" ? "" : `: ${entry.description}`;

  return `- [${entry.title}](${entry.url})${description}`;
}

interface IndexSection {
  label: string;
  items: List["children"];
}

function readSections(indexTree: Root): IndexSection[] {
  const sections: IndexSection[] = [];

  for (const block of indexTree.children) {
    if (block.type === "heading" && block.depth === 2) {
      sections.push({ label: plainText(block).trim(), items: [] });
    }

    if (block.type === "list") sections.at(-1)?.items.push(...block.children);
  }

  return sections;
}

function entryOf(item: List["children"][number], context: LinkContext): IndexEntry | undefined {
  const links: Link[] = [];

  visit(item, "link", (link) => {
    links.push(link);
  });

  const first = links[0];

  if (first === undefined) return undefined;

  const target = resolveLinkTarget(first.url, INDEX_DOCS_PATH, context);

  if (target.kind !== "rewritten" || !target.url.startsWith(MARKDOWN_TWIN_URL)) return undefined;

  const title = plainText(first).trim();
  const description = plainText(item)
    .replace(/\s+/g, " ")
    .trim()
    .slice(title.length)
    .replace(/^:\s*/, "");

  return { title, url: target.url.replace(/#.*$/, ""), description };
}
