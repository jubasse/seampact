// The seam barrel: every leaf module of `pipeline/`, and never the orchestrator or the registry. The test support
// modules (`draft-schema.ts`, `draft-fixture.ts`) are in no barrel: tests import them by path. A stage module
// (a half, link, finalize, the relay order) imports pipeline values from here only: the registry imports every
// stage module, so importing `pipeline/index.js` (which exports the orchestrator) from one would close a cycle,
// and a value read during that cycle is still in its temporal dead zone. `seam.test.ts` keeps this file
// free of the orchestrator, the registry and every stage.
export type { PipelineContextOptions } from "./context.js";
export { pipelineContext } from "./context.js";
export type {
  ConventionPath,
  ConventionReading,
  PipelineConventionDefault,
  ResolvedConventions,
} from "./conventions.js";
export {
  pipelineConventionDefaults,
  pipelineConventionLeaves,
  pipelineConventions,
  pipelineRateLimitParam,
} from "./conventions.js";
export type {
  DraftApi,
  DraftConcurrency,
  DraftFinalizeMember,
  DraftFinalizeOperationMember,
  DraftIR,
  DraftOperation,
  DraftOperationInput,
} from "./draft.js";
export { createDraftIR } from "./draft.js";
export type { DraftGuard, GuardedPart } from "./guard.js";
export { DraftAccessError, pipelineGuard } from "./guard.js";
export type { HalfName, PassName, PassOf } from "./halves.js";
export { pipelineHalves, pipelinePassOf } from "./halves.js";
export type {
  Inherited,
  InheritedEntry,
  InheritedList,
  InheritedNearest,
  InheritedPerKey,
  InheritedReader,
  NearestSetting,
  OrderedSetting,
  PerKeySetting,
  SettingName,
  UnionSetting,
} from "./inherited.js";
export { pipelineInherited } from "./inherited.js";
export type {
  DraftContainerField,
  DraftField,
  DraftOwnedField,
  DraftOwner,
  OwnershipRow,
} from "./ownership.js";
export {
  draftElementOwner,
  draftFieldSegments,
  draftOwnerText,
  draftOwnershipRow,
  pipelineContainers,
  pipelineOwnership,
} from "./ownership.js";
export type {
  TreeSchemaExampleIssue,
  PassContext,
  PassContextOf,
  PassPart,
  PassParts,
  PassResultOf,
  TreeSchemaService,
  WorkspacePass,
  WorkspacePassContext,
} from "./pass.js";
export { canonical as pipelineCanonical } from "./canonical.js";
export {
  isJsonObject as pipelineIsJsonObject,
  jsonAtPointer as pipelineJsonAtPointer,
  pipelineOrigin,
  pointerBelow as pipelinePointerBelow,
} from "./pointer.js";
export type { PassReadonly, PassWritable } from "./readonly.js";
export type {
  PipelineFinalize,
  PipelineFinalizeContext,
  PipelineFinalized,
  PipelineParts,
  PipelineRelayOrder,
  PipelineRelayStage,
} from "./stages.js";
export type { TreeNode, TreeNodeKind } from "./tree.js";
export { pipelineTreeNodes } from "./tree.js";
export { pipelineParseDuration, pipelineParseSize } from "./units.js";
export type { PipelineViewSource } from "./view.js";
export { PipelineReadonlyError, pipelineCopy } from "./view.js";
