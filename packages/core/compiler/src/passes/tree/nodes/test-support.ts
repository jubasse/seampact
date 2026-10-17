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

/** A workspace loaded from a directory, its entry `api.yaml` unless named; load diagnostics throw. */
export function treeNodesLoadDirectory(directory: string, entry = "api.yaml"): RawWorkspace {
  const loaded = loadWorkspace({ reader: loadFsReader(directory), entry });
  if (loaded.diagnostics.length > 0)
    throw new Error(`${directory}${entry} does not load: ${JSON.stringify(loaded.diagnostics)}`);
  return loaded.workspace;
}

/** A one-api workspace from an inline api file; load diagnostics throw. */
export function treeNodesLoadInline(apiYaml: string): RawWorkspace {
  const loaded = loadWorkspace({
    reader: loadMemoryReader({ "api.yaml": apiYaml }),
    entry: "api.yaml",
  });
  if (loaded.diagnostics.length > 0)
    throw new Error(`the inline api does not load: ${JSON.stringify(loaded.diagnostics)}`);
  return loaded.workspace;
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

/** A schema service answering the listed pointers in either direction, and no example issue. */
export function treeNodesStubService(rows: TreeNodesStubRows): TreeSchemaService {
  const typeUses = rows.typeUses ?? {};
  const queryWires = rows.queryWires ?? {};
  return {
    typeUse: (pointer) =>
      Object.hasOwn(typeUses, pointer) ? structuredClone(typeUses[pointer]) : undefined,
    queryWire: (pointer) =>
      Object.hasOwn(queryWires, pointer) ? structuredClone(queryWires[pointer]) : undefined,
    checkExample: () => [],
  };
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
