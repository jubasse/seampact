import { PAGE_INTRODUCTION, sectionOf, withoutPageAnchors } from "./markdown-sections.ts";
import { parseMarkdown, plainText } from "./markdown-tree.ts";
import { MARKDOWN_TWIN_URL, SITE_BASE, SITE_URL } from "./site-layout.ts";

/** Some sections of one docs page. */
interface PageSelection {
  docsPath: string;
  /** Headings the page must have: a missing one stops the build. */
  sections: string[];
  /** Headings taken when the page has them; a page that gains one is picked up without an edit here. */
  optionalSections?: string[];
  /** Written before the first heading taken, so a repeated heading says which page it is from. */
  headingPrefix?: string;
}

/** One stack file: the pages by heading that an agent needs to work on one stack. */
export interface StackFile {
  /** The file is `llms-<id>.txt`. */
  id: string;
  title: string;
  summary: string;
  /** Columns of the table in commands-per-stack.md that apply to the stack. */
  commandColumns: string[];
  guide: PageSelection[];
  validator?: PageSelection;
  /** The `##` headings of docs/troubleshooting/generate.md whose error tables the stack can meet. */
  troubleshootingFamilies: string[];
}

const SERVER_GUIDE_SECTIONS = ["Set up", "Write a handler", "Wire it in", "Limits"];
const PAGING_SECTION = ["Paging"];
const NODE_VALIDATOR_SECTIONS = [PAGE_INTRODUCTION];

const OTHER_SERVERS_VALIDATOR: PageSelection = {
  docsPath: "configuration/validators.md",
  sections: ["Other servers"],
  headingPrefix: "Validators",
};

/** The contract pages every stack shares, by heading: the file layout and a list with paging. */
const CONTRACT_ESSENTIALS: PageSelection[] = [
  { docsPath: "contract/01-basics.md", sections: ["The main blocks"] },
  { docsPath: "contract/05-lists.md", sections: ["Declare a paging style", "Use it on a list"] },
];

const COMMANDS_PAGE = "features/commands-per-stack.md";

function serverGuide(docsPath: string): PageSelection[] {
  return [{ docsPath, sections: SERVER_GUIDE_SECTIONS, optionalSections: PAGING_SECTION }];
}

const NODE_VALIDATOR: PageSelection = {
  docsPath: "configuration/validators.md",
  sections: NODE_VALIDATOR_SECTIONS,
};

/** The page of a stack's default validator library in docs/types-and-validation/. */
function validatorLibraryPage(libraryPage: string, libraryName: string): PageSelection {
  return {
    docsPath: `types-and-validation/${libraryPage}`,
    sections: ["What you get", "When a check fails", "Limits"],
    headingPrefix: libraryName,
  };
}

const NODE_COLUMNS = ["Node (npm)"];
const SHARED_FAMILY = "Spring Boot, PHP and Python";
const EVERY_SERVER_FAMILY = "Every server";
const NODE_FAMILIES = ["Node servers", EVERY_SERVER_FAMILY];

function otherServerFamilies(family: string): string[] {
  return [family, SHARED_FAMILY, EVERY_SERVER_FAMILY];
}

const SUMMARY_NODE =
  "Node server: the generated code validates every request and reply; you write the handlers and the hooks.";

export const STACK_FILES: readonly StackFile[] = [
  {
    id: "nestjs",
    commandColumns: NODE_COLUMNS,
    title: "NestJS",
    summary: SUMMARY_NODE,
    guide: [
      ...serverGuide("backend/nestjs.md"),
      validatorLibraryPage("class-validator.md", "class-validator"),
    ],
    validator: NODE_VALIDATOR,
    troubleshootingFamilies: NODE_FAMILIES,
  },
  {
    id: "express",
    commandColumns: NODE_COLUMNS,
    title: "Express",
    summary: SUMMARY_NODE,
    guide: serverGuide("backend/express.md"),
    validator: NODE_VALIDATOR,
    troubleshootingFamilies: NODE_FAMILIES,
  },
  {
    id: "fastify",
    commandColumns: NODE_COLUMNS,
    title: "Fastify",
    summary: SUMMARY_NODE,
    guide: serverGuide("backend/fastify.md"),
    validator: NODE_VALIDATOR,
    troubleshootingFamilies: NODE_FAMILIES,
  },
  {
    id: "hono",
    commandColumns: NODE_COLUMNS,
    title: "Hono",
    summary: SUMMARY_NODE,
    guide: serverGuide("backend/hono.md"),
    validator: NODE_VALIDATOR,
    troubleshootingFamilies: NODE_FAMILIES,
  },
  {
    id: "adonisjs",
    commandColumns: NODE_COLUMNS,
    title: "AdonisJS",
    summary: SUMMARY_NODE,
    guide: [...serverGuide("backend/adonisjs.md"), validatorLibraryPage("vinejs.md", "VineJS")],
    validator: NODE_VALIDATOR,
    troubleshootingFamilies: NODE_FAMILIES,
  },
  {
    id: "spring-boot",
    commandColumns: ["Gradle", "Maven"],
    title: "Spring Boot",
    summary:
      "Java and Kotlin server: a Gradle or Maven plugin generates controllers and hooks; you write the handlers.",
    guide: serverGuide("backend/spring-boot.md"),
    validator: OTHER_SERVERS_VALIDATOR,
    troubleshootingFamilies: otherServerFamilies("Spring Boot"),
  },
  {
    id: "laravel",
    commandColumns: ["PHP"],
    title: "Laravel",
    summary:
      "PHP server: a Composer package generates controllers and hooks; you write the handlers.",
    guide: serverGuide("backend/laravel.md"),
    validator: OTHER_SERVERS_VALIDATOR,
    troubleshootingFamilies: otherServerFamilies("PHP"),
  },
  {
    id: "symfony",
    commandColumns: ["PHP"],
    title: "Symfony",
    summary:
      "PHP server: a Composer package and a bundle generate controllers and hooks; you write the handlers.",
    guide: serverGuide("backend/symfony.md"),
    validator: OTHER_SERVERS_VALIDATOR,
    troubleshootingFamilies: otherServerFamilies("PHP"),
  },
  {
    id: "fastapi",
    commandColumns: ["Python"],
    title: "FastAPI",
    summary:
      "Python server: the generated Python package binds the routes; you write the handlers and the hooks.",
    guide: serverGuide("backend/fastapi.md"),
    validator: OTHER_SERVERS_VALIDATOR,
    troubleshootingFamilies: otherServerFamilies("Python"),
  },
  {
    id: "drf",
    commandColumns: ["Python"],
    title: "Django REST Framework",
    summary:
      "Python server: the generated Python package fills your URLconf; you write the handlers and the hooks.",
    guide: serverGuide("backend/drf.md"),
    validator: OTHER_SERVERS_VALIDATOR,
    troubleshootingFamilies: otherServerFamilies("Python"),
  },
  {
    id: "ninja",
    commandColumns: ["Python"],
    title: "Django Ninja",
    summary:
      "Python server: the generated Python package binds the routes; you write the handlers and the hooks.",
    guide: serverGuide("backend/ninja.md"),
    validator: OTHER_SERVERS_VALIDATOR,
    troubleshootingFamilies: otherServerFamilies("Python"),
  },
  {
    id: "clients",
    commandColumns: NODE_COLUMNS,
    title: "clients",
    summary:
      "Typed TypeScript clients: the fetch client and the React, Vue and Angular layers over it.",
    guide: [
      {
        docsPath: "frontend/fetch-client.md",
        sections: ["Add the target", "Create and call it", "ContractError"],
      },
      {
        docsPath: "frontend/react.md",
        headingPrefix: "React",
        sections: ["Add the targets", "Use the hooks"],
      },
      {
        docsPath: "frontend/vue.md",
        headingPrefix: "Vue",
        sections: ["Add the targets", "Use the composables"],
      },
      {
        docsPath: "frontend/angular.md",
        headingPrefix: "Angular",
        sections: ["Add the targets", "Provide the service"],
      },
    ],
    troubleshootingFamilies: ["Clients"],
  },
];

/** The pages of docs/ as their markdown twins, by docs path. */
export type TwinPages = ReadonlyMap<string, string>;

export function stackFileName(stack: StackFile): string {
  return `llms-${stack.id}.txt`;
}

export function stackFileUrl(stack: StackFile): string {
  return `${SITE_URL}${SITE_BASE}${stackFileName(stack)}`;
}

/** The text of `llms-<stack>.txt`: plain text with `##` headings; links to other pages keep their URL. */
export function buildStackFile(stack: StackFile, twins: TwinPages): string {
  const groups: PageSelection[] = [
    ...CONTRACT_ESSENTIALS,
    ...stack.guide,
    ...(stack.validator === undefined ? [] : [stack.validator]),
  ];
  const parts = [
    `# seampact on ${stack.title}\n\n> ${stack.summary} Each part below names its source page; open it for the rest.`,
    commandsText(stack, twins),
    ...groups.map((group) => selectionText(group, twins)),
    troubleshootingText(stack, twins),
  ];

  return `${parts.join("\n\n")}\n`;
}

function selectionText(selection: PageSelection, twins: TwinPages): string {
  const page = twins.get(selection.docsPath);

  if (page === undefined) {
    throw new Error(
      `Stack file: docs/${selection.docsPath} is not a published page. Fix the selection in stack-files.ts.`,
    );
  }

  const wanted = [...selection.sections, ...(selection.optionalSections ?? [])];
  const optional = new Set(selection.optionalSections);
  const texts: string[] = [];

  for (const heading of wanted) {
    const text = sectionOf(page, heading);

    if (text === undefined && !optional.has(heading)) {
      throw new Error(
        `Stack file: docs/${selection.docsPath} has no heading "${heading}". Restore it or fix the selection in stack-files.ts.`,
      );
    }

    if (text !== undefined) texts.push(withoutPageAnchors(text));
  }

  if (selection.headingPrefix !== undefined && texts[0] !== undefined) {
    texts[0] = texts[0].replace(/^(#+ )/, `$1${selection.headingPrefix}: `);
  }

  return `Source: ${MARKDOWN_TWIN_URL}${selection.docsPath}\n\n${texts.join("\n\n")}`;
}

const TROUBLESHOOTING_PAGE = "troubleshooting/generate.md";

function troubleshootingText(stack: StackFile, twins: TwinPages): string {
  const page = twins.get(TROUBLESHOOTING_PAGE);
  const tables = stack.troubleshootingFamilies.map((heading) => {
    const family = page === undefined ? undefined : sectionOf(page, heading);

    if (family === undefined) {
      throw new Error(
        `Stack file: docs/${TROUBLESHOOTING_PAGE} has no heading "${heading}". Restore it or fix the families of ${stack.id} in stack-files.ts.`,
      );
    }

    return withoutPageAnchors(family);
  });

  return `Source: ${MARKDOWN_TWIN_URL}${TROUBLESHOOTING_PAGE}\n\nWhen \`generate\` refuses a form, its code is in one of these tables (every code has a Fix).\n\n${tables.join("\n\n")}`;
}

/** The commands of the stack, read from the table of commands-per-stack.md by column. */
function commandsText(stack: StackFile, twins: TwinPages): string {
  const page = twins.get(COMMANDS_PAGE);
  const table =
    page === undefined
      ? undefined
      : parseMarkdown(page).children.find((block) => block.type === "table");

  if (table === undefined) {
    throw new Error(
      `Stack file: docs/${COMMANDS_PAGE} has no command table. Restore it or fix the commands of ${stack.id} in stack-files.ts.`,
    );
  }

  const [header, ...rows] = table.children.map((row) =>
    row.children.map((cell) => plainText(cell).trim()),
  );
  const lines = stack.commandColumns.map((column) => {
    const columnIndex = header?.indexOf(column) ?? -1;

    if (columnIndex === -1) {
      throw new Error(
        `Stack file: the command table of docs/${COMMANDS_PAGE} has no column "${column}". Fix the commands of ${stack.id} in stack-files.ts.`,
      );
    }

    return `${column}: ${rows.map((row) => `${row[0]} = ${row[columnIndex]}`).join("; ")}`;
  });

  return `Source: ${MARKDOWN_TWIN_URL}${COMMANDS_PAGE}\n\nCommands, run in the app folder:\n${lines.join("\n")}`;
}
