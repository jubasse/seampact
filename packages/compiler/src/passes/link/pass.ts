import type { WorkspacePass } from "../../pipeline/index.js";

// The link pass (ADR 0006 section 3: the `relays` superset, diagnostics only): a stub of the seam PR, handed to its
// lane, which declares its reads and fills `run`.
export const linkPass: WorkspacePass = {
  name: "link",
  reads: [],
  run: () => undefined,
};
