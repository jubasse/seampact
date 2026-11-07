// The references of the skills: which sections of docs/ each reference file copies.

export interface ReferenceSource {
  /** Path from docs/. */
  readonly docsPath: string;
  /** Headings to copy, in order; the whole page body when absent. */
  readonly sections?: readonly string[];
}

export interface ReferenceFile {
  /** Path from the skill folder, `references/routes.md`. */
  readonly path: string;
  readonly sources: readonly ReferenceSource[];
}

export interface SkillReferences {
  readonly skill: string;
  readonly files: readonly ReferenceFile[];
}

const BACKEND_STACKS = [
  "adonisjs",
  "drf",
  "express",
  "fastapi",
  "fastify",
  "hono",
  "laravel",
  "nestjs",
  "ninja",
  "spring-boot",
  "symfony",
] as const;

const TROUBLESHOOTING_PAGES = [
  "README",
  "access-and-errors",
  "boot",
  "bundle",
  "check",
  "cli",
  "config",
  "config-root",
  "generate",
  "link",
  "load",
  "signed-webhooks",
  "tree",
  "validate",
] as const;

function whole(docsPath: string): ReferenceSource {
  return { docsPath };
}

export const SKILL_REFERENCES: readonly SkillReferences[] = [
  {
    skill: "seampact-change-contract",
    files: [
      {
        path: "references/routes.md",
        sources: [whole("contract/01-basics.md"), whole("contract/02-types-and-refs.md")],
      },
      { path: "references/errors.md", sources: [whole("contract/03-errors.md")] },
      { path: "references/access.md", sources: [whole("contract/04-access.md")] },
      {
        path: "references/versioning.md",
        sources: [whole("contract/06-versioning.md"), whole("contract/07-advanced.md")],
      },
      { path: "references/paging-styles.md", sources: [whole("contract/05-lists.md")] },
    ],
  },
  {
    skill: "seampact-implement-handler",
    files: BACKEND_STACKS.map((stack) => ({
      path: `references/${stack}.md`,
      sources: [
        { docsPath: `backend/${stack}.md`, sections: ["Write a handler", "Paging", "Wire it in"] },
      ],
    })),
  },
  {
    skill: "seampact-fix-error",
    files: TROUBLESHOOTING_PAGES.map((page) => ({
      path: `references/${page === "README" ? "index" : page}.md`,
      sources: [whole(`troubleshooting/${page}.md`)],
    })),
  },
  {
    skill: "seampact-setup",
    files: [
      { path: "references/install.md", sources: [whole("getting-started/01-install.md")] },
      { path: "references/commands.md", sources: [whole("features/commands-per-stack.md")] },
      {
        path: "references/existing-project.md",
        sources: [whole("getting-started/04-existing-project.md")],
      },
      ...BACKEND_STACKS.map((stack) => ({
        path: `references/${stack}.md`,
        sources: [{ docsPath: `backend/${stack}.md`, sections: ["Set up", "Wire it in"] }],
      })),
    ],
  },
];
