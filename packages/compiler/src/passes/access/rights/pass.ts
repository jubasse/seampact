import type { PassPart } from "../../../pipeline/index.js";

// The access.rights half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its reads
// and writes and fills `run`.
export const accessRightsPass: PassPart<"access.rights"> = {
  pass: "access",
  half: "access.rights",
  reads: [],
  writes: [],
  run: () => undefined,
};
