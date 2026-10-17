import type { DraftIR, PipelineFinalizeContext, PipelineFinalized } from "../pipeline/seam.js";
import { pipelineCopy } from "../pipeline/seam.js";
import { finalizeCanonicalOrder } from "./canonical-order.js";
import { finalizeMembers, finalizeOperationFeatures } from "./members.js";
import { finalizeSourceMap } from "./source-map.js";
import { finalizeAssertIr, finalizeAssertSourceMap } from "./validate.js";

// Finalize (ADR 0006 sections 1 and 3, ADR 0004 sections 9 to 11): from the complete draft of one api, the
// canonical IR with its finalize members, checked against the strict IR schema and the invariants, and its side
// table. It works on its own copy of the draft and never changes the draft, whose members may alias one object.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export function finalizeIr(draft: DraftIR, context: PipelineFinalizeContext): PipelineFinalized {
  const api = context.raw.name;
  const copy = pipelineCopy(draft);

  finalizeCanonicalOrder(copy);

  const operations = copy.operations.map((operation) => ({
    ...operation,
    features: finalizeOperationFeatures(operation),
  }));
  const ir = { ...copy, ...finalizeMembers(operations), operations };

  finalizeAssertIr(api, ir);

  const sourceMap = finalizeSourceMap(ir, context.raw);

  finalizeAssertSourceMap(api, sourceMap);

  return { ir, sourceMap };
}
