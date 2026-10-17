import type { PassPart } from "../../../pipeline/seam.js";
import { treeNodesApi } from "./api.js";
import { treeNodesCheckIdProperties } from "./collections.js";
import { treeNodesCheckBodyLimits } from "./limits.js";
import { treeNodesOperations } from "./operations.js";
import { treeNodesApiSettings } from "./settings.js";

// The tree.nodes half (ADR 0006 sections 2 and 3): the api, its conventions, lint, packs and services, and the
// operations of the api tree, with the members the field ownership table gives tree.nodes. It reads `schemas` for
// the fields of a form or multipart input or of a named fields map, and for item and union checks.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const treeNodesPass: PassPart<"tree.nodes"> = {
  pass: "tree",
  half: "tree.nodes",
  reads: ["schemas"],
  writes: [
    "api",
    "conventions",
    "lint",
    "packs",
    "services",
    "operations",
    "operations[].kind",
    "operations[].id",
    "operations[].name",
    "operations[].surface",
    "operations[].op",
    "operations[].resource",
    "operations[].method",
    "operations[].path",
    "operations[].safe",
    "operations[].params",
    "operations[].unknownQuery",
    "operations[].input.media",
    "operations[].input.schema",
    "operations[].input.origin",
    "operations[].input.fields",
    "operations[].responses",
    "operations[].format",
    "operations[].origin",
  ],
  run: (draft, context) => {
    const prefixes = treeNodesApi(draft, context);
    treeNodesApiSettings(draft, context);
    treeNodesCheckBodyLimits(context);
    treeNodesOperations(draft, context, prefixes);
    treeNodesCheckIdProperties(draft, context);
  },
};
