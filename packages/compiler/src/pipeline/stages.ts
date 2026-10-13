import type { ContractIR, SourceMap } from "@seampact/spec/ir";
import type { Diagnostic } from "../diagnostics/diagnostic.js";
import type { RawApi, RawWorkspace } from "../raw-tree.js";
import type { ApiDiagnostics } from "../validate/validate.js";
import type { DraftIR } from "./draft.js";
import type { PassParts, WorkspacePass } from "./pass.js";
import type { PassReadonly } from "./readonly.js";

// The stages the orchestrator runs besides the passes (ADR 0006 section 1), as the seam types p2-finalize fills:
// the relay order of the workspace's apis, and finalize per api. Both are injected like the halves
// (`PipelineParts`), with the stubs of `registry.ts` as defaults.

/** The relay order of a workspace (ADR 0006 section 1), owned by p2-finalize (`workspaceRelayOrder`). */
export interface PipelineRelayOrder {
  /** Every workspace api once, each after every workspace api its relay routes name. */
  readonly order: readonly string[];
  /** Per api, the workspace apis its relay routes name: the stop rule skips an api that relays to a stopped one. */
  readonly relaysTo: ReadonlyMap<string, readonly string[]>;
  /** Errors of the step (a relay cycle names its apis), each listed under the api whose table locates it. */
  readonly diagnostics: readonly ApiDiagnostics[];
}

export type PipelineRelayStage = (workspace: PassReadonly<RawWorkspace>) => PipelineRelayOrder;

/** What finalize receives besides the complete draft, which it gets unwrapped (no guard). */
export interface PipelineFinalizeContext {
  readonly raw: PassReadonly<RawApi>;
  report(diagnostic: Diagnostic): void;
}

/** What finalize produces for one api: the canonical IR and its side table (ADR 0004 sections 9 to 11). */
export interface PipelineFinalized {
  readonly ir: ContractIR;
  readonly sourceMap: SourceMap;
}

/** Finalize of one api (p2-finalize, `finalizeIr`); an api whose finalize reports an error produces no IR. */
export type PipelineFinalize = (
  draft: DraftIR,
  context: PipelineFinalizeContext,
) => PipelineFinalized | undefined;

/** Every part the orchestrator runs, as `compileWorkspace` receives them (`parts`, over the defaults). */
export interface PipelineParts {
  readonly passes: PassParts;
  readonly link: WorkspacePass;
  readonly relayOrder: PipelineRelayStage;
  readonly finalize: PipelineFinalize;
}
