import type { PassPart } from "../../../pipeline/seam.js";
import { treeNodesOperations } from "./operations.js";

// The tree.nodes half (ADR 0006 sections 2 and 3): the operations of the api tree, with the members the field
// ownership table gives tree.nodes. It reads `schemas` for the fields of a form or multipart input.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const treeNodesPass: PassPart<"tree.nodes"> = {
  pass: "tree",
  half: "tree.nodes",
  reads: ["schemas"],
  writes: [
    "operations",
    "operations[].kind",
    "operations[].id",
    "operations[].name",
    "operations[].surface",
    "operations[].op",
    "operations[].resource",
    "operations[].method",
    "operations[].safe",
    "operations[].input.media",
    "operations[].input.schema",
    "operations[].input.origin",
    "operations[].input.fields",
    "operations[].origin",
  ],
  run: (draft, context) => {
    treeNodesOperations(draft, context);
  },
};
