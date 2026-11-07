// The pipeline barrel: the seam (`seam.ts`) and the orchestrator with its default parts. A stage module never
// imports this file: it imports `seam.ts` (see there).

export type { PipelineDeclared } from "./declared.js";
export type { PipelineApiResult, PipelineOptions, PipelineResult } from "./orchestrator.js";
export { compileWorkspace } from "./orchestrator.js";
export { pipelineDefaultParts } from "./registry.js";
export * from "./seam.js";
