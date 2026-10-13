import { finalizeIr } from "../finalize/finalize.js";
import { accessIdentityPass } from "../passes/access/identity/pass.js";
import { accessRightsPass } from "../passes/access/rights/pass.js";
import { deriveErrorsPass } from "../passes/derive/errors/pass.js";
import { deriveWirePass } from "../passes/derive/wire/pass.js";
import { linkPass } from "../passes/link/pass.js";
import { treeNodesPass } from "../passes/tree/nodes/pass.js";
import { treeSchemasPass } from "../passes/tree/schemas/pass.js";
import { workspaceRelayOrder } from "../workspace/order.js";
import type { PipelineParts } from "./stages.js";

// The parts `compileWorkspace` runs unless its `parts` option replaces them: each stage's export by its
// stage-prefixed name, so a lane fills its stub and this file never changes. A function the orchestrator calls at
// run time, never a value built when this module loads: a stage module that a cycle reaches before it has run
// (a stage importing the pipeline barrel, against the rule of `seam.ts`) is then read only after it has.

/** The default parts, read when called. */
export const pipelineDefaultParts = (): PipelineParts =>
  Object.freeze({
    passes: Object.freeze({
      "tree.schemas": treeSchemasPass,
      "tree.nodes": treeNodesPass,
      "access.identity": accessIdentityPass,
      "access.rights": accessRightsPass,
      "derive.wire": deriveWirePass,
      "derive.errors": deriveErrorsPass,
    }),
    link: linkPass,
    relayOrder: workspaceRelayOrder,
    finalize: finalizeIr,
  });
