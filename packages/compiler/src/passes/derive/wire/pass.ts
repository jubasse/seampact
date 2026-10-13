import type { PassPart } from "../../../pipeline/index.js";

// The derive.wire half (ADR 0006 sections 2 and 3): a stub of the seam PR, handed to its lane, which declares its reads
// and writes and fills `run`.
export const deriveWirePass: PassPart<"derive.wire"> = {
  pass: "derive",
  half: "derive.wire",
  reads: [],
  writes: [],
  run: () => undefined,
};
