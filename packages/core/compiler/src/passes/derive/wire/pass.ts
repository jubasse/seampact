import type { PassPart } from "../../../pipeline/seam.js";

// The derive.wire half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its reads
// and writes and fills `run`.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const deriveWirePass: PassPart<"derive.wire"> = {
  pass: "derive",
  half: "derive.wire",
  reads: [],
  writes: [],
  run: () => undefined,
};
