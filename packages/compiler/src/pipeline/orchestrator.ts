import type { ContractIR, SourceMap } from "@seampact/spec/ir";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import { diagnosticSort } from "../diagnostics/print.js";
import { type LoadOptions, loadWorkspace } from "../load/index.js";
import type { RawApi, RawWorkspace } from "../raw-tree.js";
import { validateWorkspace } from "../validate/index.js";
import { pipelineContext } from "./context.js";
import { createDraftIR, type DraftIR } from "./draft.js";
import { type GuardedPart, pipelineGuard } from "./guard.js";
import { pipelineHalves } from "./halves.js";
import type { PassContext, PassParts, TreeSchemaService, WorkspacePass } from "./pass.js";
import type { PassReadonly } from "./readonly.js";
import { pipelineDefaultParts } from "./registry.js";
import type {
  PipelineFinalize,
  PipelineFinalized,
  PipelineParts,
  PipelineRelayStage,
} from "./stages.js";
import { pipelineView } from "./view.js";

// The orchestrator of ADR 0006 section 1: load -> validate -> relay order -> per api the six halves -> link ->
// finalize per api, under the stop rule:
// - load stops on an error, validate on any diagnostic: nothing after them runs;
// - a step that reports an error completes, every error of it is reported, and no later step of that api runs;
//   an api that relays to a stopped api (directly or not) is skipped with no diagnostic of its own; independent
//   apis continue;
// - link and finalize run only when no api has an error; warnings never stop anything.
// With `guard: true`, each half runs on a guarded draft disposed when it ends (`guard.ts`), and what it reads
// besides (`raw`, `workspace`, `relayed`, `imported`, `inherited` entries) is read-only (`view.ts`).

export interface PipelineOptions extends LoadOptions {
  /** Parts replacing the defaults of `registry.ts`; `passes` half by half (the orchestrator tests' fakes). */
  readonly parts?: {
    readonly passes?: Partial<PassParts>;
    readonly link?: WorkspacePass;
    readonly relayOrder?: PipelineRelayStage;
    readonly finalize?: PipelineFinalize;
  };
  /** The guard and the read-only views (ADR 0006 section 2): off by default, on in every pass and pipeline test. */
  readonly guard?: boolean;
  /** The IRs of imported apis by name, which `imported` returns (p3-dist wires pinned bundles). */
  readonly imports?: ReadonlyMap<string, ContractIR>;
}

export interface PipelineApiResult {
  readonly api: string;
  /** Every diagnostic listed under the api, sorted by file, line, column and rule (ADR 0006 section 4). */
  readonly diagnostics: readonly Diagnostic[];
  /** The api's side table, which locates its diagnostics. */
  readonly locations: SourceMap["locations"];
  /** The finalized IR and its side table, when finalize produced them. */
  readonly ir?: ContractIR;
  readonly sourceMap?: SourceMap;
}

export interface PipelineResult {
  /** Every file the load stage read or tried to read, sorted (`LoadResult.files`), for the watch primitive. */
  readonly files: readonly string[];
  /** The load stage's diagnostics and the workspace entry's, sorted, located through `locations`. */
  readonly diagnostics: readonly Diagnostic[];
  /** The workspace table (`RawWorkspace.locations`), beside each api's own (ADR 0006 section 4). */
  readonly locations: SourceMap["locations"];
  /** One entry per api, in workspace order; empty when the load stage stopped. */
  readonly apis: readonly PipelineApiResult[];
}

interface ApiRun {
  readonly raw: RawApi;
  readonly diagnostics: Diagnostic[];
  finalized?: PipelineFinalized;
}

const hasError = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((d) => d.severity === "error");

/** Compiles a workspace (ADR 0006 section 1); see the module comment for the stop rule. */
export function compileWorkspace(options: PipelineOptions): PipelineResult {
  const guard = options.guard === true;
  const defaults = pipelineDefaultParts();
  const parts: PipelineParts = {
    passes: { ...defaults.passes, ...options.parts?.passes },
    link: options.parts?.link ?? defaults.link,
    relayOrder: options.parts?.relayOrder ?? defaults.relayOrder,
    finalize: options.parts?.finalize ?? defaults.finalize,
  };
  // The options whole: a load option added later reaches the load stage without a change here.
  const loaded = loadWorkspace(options);
  const workspace = loaded.workspace;
  const workspaceDiagnostics = [...loaded.diagnostics];
  const sortedWorkspace = () => diagnosticSort(workspaceDiagnostics, workspace.locations);
  if (hasError(loaded.diagnostics))
    return {
      files: loaded.files,
      diagnostics: sortedWorkspace(),
      locations: workspace.locations,
      apis: [],
    };

  const runs = new Map<string, ApiRun>(
    workspace.apis.map((raw) => [raw.name, { raw, diagnostics: [] }]),
  );
  const runOf = (api: string): ApiRun => {
    const run = runs.get(api);
    if (run === undefined) throw new Error(`no workspace api named ${api}`);
    return run;
  };
  const finish = (): PipelineResult => ({
    files: loaded.files,
    diagnostics: sortedWorkspace(),
    locations: workspace.locations,
    apis: [...runs.values()].map(({ raw, diagnostics, finalized }) => ({
      api: raw.name,
      diagnostics: diagnosticSort(diagnostics, raw.locations),
      locations: raw.locations,
      ...(finalized === undefined ? {} : { ir: finalized.ir, sourceMap: finalized.sourceMap }),
    })),
  });
  const viewed = <T>(value: T, source: "raw" | "workspace" | "imported"): T =>
    guard ? pipelineView(value, source) : value;

  const validated = validateWorkspace(workspace);
  workspaceDiagnostics.push(...validated.workspace);
  for (const entry of validated.apis) runOf(entry.api).diagnostics.push(...entry.diagnostics);
  if (validated.workspace.length > 0 || validated.apis.some((e) => e.diagnostics.length > 0))
    return finish();

  const relay = parts.relayOrder(viewed(workspace, "workspace"));
  if (
    relay.order.length !== runs.size ||
    new Set(relay.order).size !== runs.size ||
    relay.order.some((api) => !runs.has(api))
  )
    throw new Error("the relay order must list every workspace api once, and no other name");
  for (const entry of relay.diagnostics) runOf(entry.api).diagnostics.push(...entry.diagnostics);

  const drafts = new Map<string, DraftIR>();
  const stopped = new Set<string>();
  // Whether `api` relays to a stopped api, directly or through other workspace apis.
  const relaysToStopped = (api: string, seen = new Set<string>()): boolean => {
    for (const target of relay.relaysTo.get(api) ?? []) {
      if (stopped.has(target)) return true;
      if (seen.has(target)) continue;
      seen.add(target);
      if (relaysToStopped(target, seen)) return true;
    }
    return false;
  };

  // One half of one api, as a step of the stop rule: false when it reported an error.
  const step = (
    run: ApiRun,
    draft: DraftIR,
    part: GuardedPart,
    body: (draft: DraftIR, context: PassContext) => void,
  ): boolean => {
    const reported: Diagnostic[] = [];
    let open = true;
    const context = pipelineContext({
      raw: run.raw,
      workspace,
      relayed: drafts,
      ...(options.imports === undefined ? {} : { imports: options.imports }),
      guard,
      report: (diagnostic) => {
        if (!open) throw new Error(`${part.half} reported a diagnostic after its run ended`);
        reported.push(diagnostic);
      },
    });
    const guarded = guard ? pipelineGuard(draft, part) : undefined;
    try {
      body(guarded?.draft ?? draft, context);
    } finally {
      open = false;
      guarded?.dispose();
    }
    run.diagnostics.push(...reported);
    return !hasError(reported);
  };

  const runHalves = (run: ApiRun): DraftIR | undefined => {
    const draft = createDraftIR();
    let treeSchemas: TreeSchemaService | undefined;
    for (const half of pipelineHalves) {
      const passed = step(run, draft, parts.passes[half], (guarded, context) => {
        if (half === "tree.schemas") {
          treeSchemas = parts.passes[half].run(guarded, context);
          return;
        }

        if (treeSchemas === undefined) throw new Error("tree.schemas returned no schema service");
        parts.passes[half].run(guarded, Object.freeze({ ...context, treeSchemas }));
      });
      if (!passed) return undefined;
    }
    return draft;
  };

  for (const api of relay.order) {
    const run = runOf(api);
    const draft = hasError(run.diagnostics) || relaysToStopped(api) ? undefined : runHalves(run);
    if (draft === undefined) stopped.add(api);
    else drafts.set(api, draft);
  }

  // With no error anywhere, every api ran all its halves, so every api has its draft.
  const clean = () => [...runs.values()].every((run) => !hasError(run.diagnostics));
  const draftOf = (api: string): DraftIR => {
    const draft = drafts.get(api);
    if (draft === undefined) throw new Error(`api ${api} has no derived draft`);
    return draft;
  };
  if (clean()) {
    const apis = [...runs.keys()];
    link(parts.link, apis, draftOf, runOf, {
      guard,
      imports: options.imports,
      workspace: viewed(workspace, "workspace"),
    });
  }
  if (clean()) {
    for (const run of runs.values()) {
      const draft = draftOf(run.raw.name);
      const reported: Diagnostic[] = [];
      let open = true;
      let finalized: PipelineFinalized | undefined;
      try {
        finalized = parts.finalize(draft, {
          raw: viewed(run.raw, "raw"),
          report: (diagnostic) => {
            if (!open) throw new Error("finalize reported a diagnostic after its run ended");
            reported.push(diagnostic);
          },
        });
      } finally {
        open = false;
      }
      run.diagnostics.push(...reported);
      if (finalized !== undefined && !hasError(reported)) run.finalized = finalized;
    }
  }
  return finish();
}

// The link pass over every api's derived draft, in workspace order; read-only by guard as well as by type.
function link(
  pass: WorkspacePass,
  apis: readonly string[],
  draftOf: (api: string) => DraftIR,
  runOf: (api: string) => ApiRun,
  options: {
    guard: boolean;
    imports: ReadonlyMap<string, ContractIR> | undefined;
    workspace: PassReadonly<RawWorkspace>;
  },
): void {
  const part: GuardedPart = { half: "link", reads: pass.reads, writes: [] };
  // One view per import, so an import read twice is the same object (as `relayed` and `imported` of a half).
  const importedViews = new Map<string, ContractIR>();
  const guards = apis.map((api) => {
    const draft = draftOf(api);
    return { api, draft, guarded: options.guard ? pipelineGuard(draft, part) : undefined };
  });
  let open = true;
  try {
    pass.run(new Map(guards.map(({ api, draft, guarded }) => [api, guarded?.draft ?? draft])), {
      workspace: options.workspace,
      imported: (api) => {
        const ir = options.imports?.get(api);
        if (ir === undefined || !options.guard) return ir;
        let view = importedViews.get(api);
        if (view === undefined) {
          view = pipelineView(ir, "imported");
          importedViews.set(api, view);
        }
        return view;
      },
      report: (api, diagnostic) => {
        if (!open) throw new Error("link reported a diagnostic after its run ended");
        runOf(api).diagnostics.push(diagnostic);
      },
    });
  } finally {
    open = false;
    for (const { guarded } of guards) guarded?.dispose();
  }
}
