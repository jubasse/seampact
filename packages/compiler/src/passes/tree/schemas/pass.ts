import type { PassPart, TreeSchemaService } from "../../../pipeline/seam.js";

// The tree.schemas half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its
// reads and writes and fills `run`. Its run returns the schema service tree.nodes receives; the stub's knows no
// schema.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
const noSchemas: TreeSchemaService = {
  typeUse: () => undefined,
  queryWire: () => undefined,
  checkExample: () => [],
};

export const treeSchemasPass: PassPart<"tree.schemas"> = {
  pass: "tree",
  half: "tree.schemas",
  reads: [],
  writes: [],
  run: () => noSchemas,
};
