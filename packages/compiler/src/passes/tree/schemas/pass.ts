import type { PassPart, TreeSchemaService } from "../../../pipeline/index.js";

// The tree.schemas half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its
// reads and writes and fills `run`. Its run returns the schema service tree.nodes receives; the stub's knows no
// schema.
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
