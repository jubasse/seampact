import type { PipelineFinalize } from "../pipeline/index.js";

// Finalize (ADR 0006 section 1, ADR 0004 sections 9 to 11): a stub of the seam PR, handed to p2-finalize. It
// produces nothing yet, so `compileWorkspace` returns no IR.
export const finalizeIr: PipelineFinalize = () => undefined;
