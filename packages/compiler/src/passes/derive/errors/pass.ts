import type { PassPart } from "../../../pipeline/index.js";

// The derive.errors half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its reads
// and writes and fills `run`.
export const deriveErrorsPass: PassPart<"derive.errors"> = {
  pass: "derive",
  half: "derive.errors",
  reads: [],
  writes: [],
  run: () => undefined,
};
