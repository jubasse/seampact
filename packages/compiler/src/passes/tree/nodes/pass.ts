import type { PassPart } from "../../../pipeline/index.js";

// The tree.nodes half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its reads
// and writes and fills `run`.
export const treeNodesPass: PassPart<"tree.nodes"> = {
  pass: "tree",
  half: "tree.nodes",
  reads: [],
  writes: [],
  run: () => undefined,
};
