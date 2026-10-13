import type { PipelineRelayStage } from "../pipeline/seam.js";

// The relay order of a workspace (ADR 0006 section 1): a stub of the seam PR, handed to p2-finalize, which orders
// the apis by their relay routes and reports cycles. The stub keeps the workspace order and knows no relay.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const workspaceRelayOrder: PipelineRelayStage = (workspace) => ({
  order: workspace.apis.map((api) => api.name),
  relaysTo: new Map(),
  diagnostics: [],
});
