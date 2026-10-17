import { fileURLToPath } from "node:url";
import type { Diagnostic } from "../../../diagnostics/diagnostic.js";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import { loadFsReader, loadWorkspace } from "../../../load/index.js";
import { loadMemoryReader, type LoadReader } from "../../../load/reader.js";
import {
  createDraftIR,
  type DraftIR,
  pipelineContext,
  pipelineGuard,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import { validateWorkspace } from "../../../validate/index.js";
import { treeSchemasPass } from "./pass.js";

// Test support, outside the barrel: runs tree.schemas alone, guarded, on a loaded and validated workspace.

export interface TreeSchemasRun {
  draft: DraftIR;
  diagnostics: Diagnostic[];
  service: TreeSchemaService;
  /** Whether every diagnostic origin resolves in the api's side table. */
  located: boolean;
}

const REFERENCE = fileURLToPath(
  new URL("../../../../../../../fixtures/reference", import.meta.url),
);

function run(reader: LoadReader, entry: string, api: string): TreeSchemasRun {
  const loaded = loadWorkspace({ reader, entry });
  const validated = validateWorkspace(loaded.workspace);
  const earlier = [
    ...loaded.diagnostics,
    ...validated.workspace,
    ...validated.apis.flatMap((e) => e.diagnostics),
  ];

  if (earlier.length > 0)
    throw new Error(`the contract does not load: ${earlier.map((d) => d.message).join("; ")}`);
  const raw = loaded.workspace.apis.find((candidate) => candidate.name === api);

  if (raw === undefined) throw new Error(`no api ${api}`);

  const diagnostics: Diagnostic[] = [];
  const context = pipelineContext({
    raw,
    workspace: loaded.workspace,
    guard: true,
    report: (diagnostic) => diagnostics.push(diagnostic),
  });
  const draft = createDraftIR();
  const guarded = pipelineGuard(draft, treeSchemasPass);
  const service = treeSchemasPass.run(guarded.draft, context);

  guarded.dispose();
  const located = diagnostics.every((d) =>
    [d.origin, ...d.related.map((r) => r.origin)].every((origin) =>
      Object.hasOwn(raw.locations, diagnosticLocationKey(origin)),
    ),
  );

  return { draft, diagnostics, service, located };
}

/** tree.schemas on the reference contract, for one of its apis. */
export const treeSchemasRunReference = (api: "tasks" | "tasksService"): TreeSchemasRun =>
  run(loadFsReader(REFERENCE), "workspace.yaml", api);

/** tree.schemas on a single api file `api.yaml` named `t`, its catalogues given as YAML text. */
export const treeSchemasRunApi = (catalogues: string): TreeSchemasRun =>
  run(
    loadMemoryReader({ "api.yaml": `api: { name: t, version: 1 }\n${catalogues}` }),
    "api.yaml",
    "t",
  );

/** The rules of a run's diagnostics, without the `seampact/tree/` prefix. */
export const treeSchemasRules = (result: TreeSchemasRun): string[] =>
  result.diagnostics.map((d) => d.rule.replace("seampact/tree/", ""));
