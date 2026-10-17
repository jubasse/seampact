import { fileURLToPath } from "node:url";
import type { IrWriter } from "@seampact/spec/ir";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { loadFsReader, loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader } from "../../../load/reader.js";
import {
  createDraftIR,
  type DraftIR,
  pipelineContext,
  pipelineGuard,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import type { RawApi, RawWorkspace } from "../../../raw-tree.js";
import { treeNodesPass } from "./pass.js";

// Test support of tree.nodes, outside the barrel: loading contracts, a small schema service for inline contracts
// (the fixture service answers the reference contract only), and a guarded run of the half.

const FIXTURES = fileURLToPath(new URL("../../../../../../../fixtures/", import.meta.url));

/** The directory of this lane's fixtures. */
export const TREE_NODES_FIXTURES = `${FIXTURES}passes/tree-nodes/`;

/** The directory of the reference contract. */
export const REFERENCE_CONTRACT = `${FIXTURES}reference/`;

/**
 * A cursor paging style and the conventions naming it, for an inline contract whose lists are not what its test
 * checks: every list names a style or `paging: none` (ADR 0002 section 10).
 */
export const TREE_NODES_CURSOR_PAGING = `
pagings:
  cursor:
    request: { cursor: { query: cursor }, limit: { query: limit } }
    response: { body: $items }
conventions:
  paging: { default: cursor, maxLimit: 50 }
`;

/** A workspace loaded from a directory, its entry `api.yaml` unless named; load diagnostics throw. */
export function treeNodesLoadDirectory(directory: string, entry = "api.yaml"): RawWorkspace {
  const loaded = loadWorkspace({ reader: loadFsReader(directory), entry });

  if (loaded.diagnostics.length > 0)
    throw new Error(`${directory}${entry} does not load: ${JSON.stringify(loaded.diagnostics)}`);

  return loaded.workspace;
}

/** A one-api workspace from an inline api file; load diagnostics throw. */
export function treeNodesLoadInline(apiYaml: string): RawWorkspace {
  return treeNodesLoadFiles({ "api.yaml": apiYaml });
}

/** A one-api workspace from inline files, its entry `api.yaml` (packs beside it); load diagnostics throw. */
export function treeNodesLoadFiles(files: Readonly<Record<string, string>>): RawWorkspace {
  const loaded = loadWorkspace({ reader: loadMemoryReader({ ...files }), entry: "api.yaml" });

  if (loaded.diagnostics.length > 0)
    throw new Error(`the inline api does not load: ${JSON.stringify(loaded.diagnostics)}`);

  return loaded.workspace;
}

/** An object schema of the draft catalogue, each property required, declared at `pointer`. */
export function treeNodesObjectSchema(
  id: string,
  pointer: string,
  properties: Record<string, IrWriter.TypeUse>,
): IrWriter.ObjectSchema {
  return {
    kind: "object",
    id,
    name: { segments: [id.toLowerCase()], role: "schema" },
    directions: ["input"],
    examples: [],
    docs: {},
    extensions: {},
    origin: { layer: "api", pointer },
    properties: Object.entries(properties).map(([name, type]) => ({
      name,
      type,
      optional: false,
      nullable: false,
      sensitive: false,
      deprecated: false,
      docs: {},
      extensions: {},
      origin: { layer: "api", pointer: `${pointer}/properties/${name}` },
    })),
  };
}

/** A union of the draft catalogue whose tag is read from the request header `header`. */
export function treeNodesHeaderUnion(id: string, header: string): IrWriter.UnionSchema {
  return {
    kind: "union",
    id,
    name: { segments: [id.toLowerCase()], role: "schema" },
    tag: { in: "header", name: header },
    variants: [],
    directions: ["input", "output"],
    examples: [],
    docs: {},
    extensions: {},
    origin: { layer: "api", pointer: `/schemas/${id}` },
  };
}

/** A new draft holding `schemas`, as tree.schemas would leave it. */
export function treeNodesDraftWith(...schemas: IrWriter.Schema[]): DraftIR {
  const draft = createDraftIR();

  for (const schema of schemas) draft.schemas[schema.id] = schema;

  return draft;
}

export function treeNodesApiOf(workspace: RawWorkspace, name?: string): RawApi {
  const api =
    name === undefined
      ? workspace.apis[0]
      : workspace.apis.find((candidate) => candidate.name === name);

  if (api === undefined) throw new Error(`the workspace has no api ${name ?? ""}`);

  return api;
}

/** The rows of a small schema service: the type use of each pointer, the query wire of each form field. */
export interface TreeNodesStubRows {
  readonly typeUses?: Readonly<Record<string, IrWriter.TypeUse>>;
  readonly queryWires?: Readonly<Record<string, IrWriter.QueryWire>>;
}

/** An example value holding this string anywhere fails `checkExample` of the stub service, at that place. */
export const TREE_NODES_INVALID_EXAMPLE = "invalid";

/** A schema service answering the listed pointers in either direction; an example fails where it holds the marker. */
export function treeNodesStubService(rows: TreeNodesStubRows): TreeSchemaService {
  const typeUses = rows.typeUses ?? {};
  const queryWires = rows.queryWires ?? {};

  return {
    typeUse: (pointer) =>
      Object.hasOwn(typeUses, pointer) ? structuredClone(typeUses[pointer]) : undefined,
    queryWire: (pointer) =>
      Object.hasOwn(queryWires, pointer) ? structuredClone(queryWires[pointer]) : undefined,
    checkExample: (value) =>
      markersIn(value, "").map((pointer) => ({ pointer, message: "the value is invalid" })),
  };
}

function markersIn(value: unknown, pointer: string): string[] {
  if (value === TREE_NODES_INVALID_EXAMPLE) return [pointer];

  if (typeof value !== "object" || value === null) return [];

  return Object.entries(value).flatMap(([key, member]) => markersIn(member, `${pointer}/${key}`));
}

export interface TreeNodesRunOptions {
  readonly treeSchemas: TreeSchemaService;
  /** The draft as tree.schemas left it (its `schemas`), else a new draft. */
  readonly draft?: DraftIR;
}

export interface TreeNodesRun {
  readonly draft: DraftIR;
  readonly diagnostics: Diagnostic[];
}

/** Runs tree.nodes on `raw` with the guard on, as the orchestrator does. */
export function treeNodesRun(
  raw: RawApi,
  workspace: RawWorkspace,
  options: TreeNodesRunOptions,
): TreeNodesRun {
  const draft = options.draft ?? createDraftIR();
  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace,
    report: (diagnostic) => diagnostics.push(diagnostic),
    guard: true,
  });
  const guarded = pipelineGuard(draft, treeNodesPass);

  try {
    treeNodesPass.run(
      guarded.draft,
      Object.freeze({ ...context, treeSchemas: options.treeSchemas }),
    );
  } finally {
    guarded.dispose();
  }

  return { draft, diagnostics };
}
