import type { ContractIR } from "@seampact/spec/ir";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { RawApi, RawWorkspace } from "../raw-tree.js";
import { pipelineConventions } from "./conventions.js";
import type { DraftIR } from "./draft.js";
import { pipelineInherited } from "./inherited.js";
import type { PassContext } from "./pass.js";
import { pipelineOrigin } from "./pointer.js";
import type { PassReadonly } from "./readonly.js";
import { pipelineView } from "./view.js";

export interface PipelineContextOptions {
  readonly raw: RawApi;
  readonly workspace: RawWorkspace;
  /** The derived drafts of the workspace apis that already ran, by api name. */
  readonly relayed?: ReadonlyMap<string, DraftIR>;
  /** The IRs of imported apis, by api name (the `imports` option). */
  readonly imports?: ReadonlyMap<string, ContractIR>;
  report(diagnostic: Diagnostic): void;
  /** Read-only views of `raw`, `workspace`, `relayed` and `imported`, as a guarded run has (ADR 0006 section 2). */
  readonly guard?: boolean;
}

/**
 * The context of one half of one api (ADR 0006 section 2), as the orchestrator builds it; a pass test builds its
 * context with it too, `guard: true`. The context is frozen; `conventions` and `inherited` read the same raw tree
 * the half sees, so with the guard on their values are read-only too, and inherited results are frozen.
 */
export function pipelineContext(options: PipelineContextOptions): PassContext {
  const guard = options.guard === true;
  const raw: PassReadonly<RawApi> = guard ? pipelineView(options.raw, "raw") : options.raw;
  const relayedViews = new Map<string, DraftIR>();
  const importedViews = new Map<string, ContractIR>();
  return Object.freeze({
    raw,
    workspace: guard ? pipelineView(options.workspace, "workspace") : options.workspace,
    conventions: pipelineConventions(raw),
    inherited: pipelineInherited(raw),
    origin: (pointer: string) => pipelineOrigin(raw, pointer),
    relayed: (api: string) => viewOf(options.relayed, api, relayedViews, guard, "relayed"),
    imported: (api: string) => viewOf(options.imports, api, importedViews, guard, "imported"),
    report: (diagnostic: Diagnostic) => options.report(diagnostic),
  });
}

function viewOf<T>(
  source: ReadonlyMap<string, T> | undefined,
  api: string,
  views: Map<string, T>,
  guard: boolean,
  kind: "relayed" | "imported",
): T | undefined {
  const value = source?.get(api);
  if (value === undefined || !guard) return value;
  let view = views.get(api);
  if (view === undefined) {
    view = pipelineView(value, kind);
    views.set(api, view);
  }
  return view;
}
