import type { PipelineRelayStage } from "../pipeline/index.js";

// The relay order of a workspace (ADR 0006 section 1): a stub of the seam PR, handed to p2-finalize, which orders
// the apis by their relay routes and reports cycles. The stub keeps the workspace order and knows no relay.
export const workspaceRelayOrder: PipelineRelayStage = (workspace) => ({
  order: workspace.apis.map((api) => api.name),
  relaysTo: new Map(),
  diagnostics: [],
});
