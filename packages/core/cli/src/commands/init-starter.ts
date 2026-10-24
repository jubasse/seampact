// What `seampact init` writes in a new project: the app config and a contract that compiles as written.

/** The `path` source the starter config names, and the folder of its contract. */
export const STARTER_SOURCE_DIRECTORY = "contracts";

/** The contract's single api file: the entry of a workspace without `workspace.yaml` (grammar section 1). */
export const STARTER_CONTRACT_FILE = "api.yaml";

/** `--blank`: the api header alone; otherwise a small example to edit. */
export type StarterContent = "example" | "blank";

const EXAMPLE_API = "notes";
const BLANK_API = "api";

export function starterConfig(content: StarterContent): string {
  return `# Where the contracts are and what seampact generates from them.
outDir: src/__generated__
sources:
  ${STARTER_SOURCE_DIRECTORY}:
    path: ./${STARTER_SOURCE_DIRECTORY}
targets:
  # The TypeScript types of the api (npm package @seampact/codegen-ts). Add a server or a client target beside it.
  - id: types
    use: "@seampact/codegen-ts"
    apis: [${content === "blank" ? BLANK_API : EXAMPLE_API}]
`;
}

export function starterContract(content: StarterContent): string {
  return content === "blank" ? BLANK_CONTRACT : EXAMPLE_CONTRACT;
}

const BLANK_CONTRACT = `# The contract of your api. Add its schemas and routes, then run \`seampact compile\`.
api:
  name: ${BLANK_API}
  version: 1
  kind: product
  maturity: provisional
  summary: The api this app serves.
`;

const EXAMPLE_CONTRACT = `# An example contract: one api with a collection of notes, listed and read.
# Edit it or replace it, then run \`seampact compile\`.
api:
  name: ${EXAMPLE_API}
  version: 1
  kind: product
  maturity: provisional
  summary: A small notes api.

# How a list is paged: a cursor and a limit in the query, the next page in the links.
pagings:
  cursor:
    request:
      cursor: { query: cursor }
      limit: { query: limit }
    response:
      body: $items
      links: { next: $next }

# The data the routes send.
schemas:
  NoteId: { type: string, format: uuid }
  Note:
    type: object
    required: [noteId, title]
    properties:
      noteId: NoteId
      title: { type: string, minLength: 1, maxLength: 100 }
      body: { type: string, maxLength: 2000 }

# The routes, under /v1. \`access\` says who may call them.
surfaces:
  app:
    prefix: /v{version}
    access: { public: "Anyone may call this api: it has no accounts." }
    routes:
      notes:
        kind: collection
        id: { noteId: NoteId }
        item: Note
        ops:
          # Lists the notes, a page at a time.
          list: { paging: { cursor: { maxLimit: 50 } } }
          # Reads one note by its noteId.
          get: {}
`;
