import type { PassPart } from "../../../pipeline/index.js";

// The access.identity half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its reads
// and writes and fills `run`.
export const accessIdentityPass: PassPart<"access.identity"> = {
  pass: "access",
  half: "access.identity",
  reads: [],
  writes: [],
  run: () => undefined,
};
