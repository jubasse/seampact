import type { PipelineFinalize } from "../pipeline/seam.js";

// Finalize (ADR 0006 section 1, ADR 0004 sections 9 to 11): a stub of the seam PR, handed to p2-finalize. It
// produces nothing yet, so `compileWorkspace` returns no IR.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const finalizeIr: PipelineFinalize = () => undefined;
