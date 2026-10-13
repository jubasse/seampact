import type { WorkspacePass } from "../../pipeline/seam.js";

// The link pass (ADR 0006 section 3: the `relays` superset, diagnostics only): a stub of the seam PR, handed to its
// lane, which declares its reads and fills `run`.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const linkPass: WorkspacePass = {
  name: "link",
  reads: [],
  run: () => undefined,
};
