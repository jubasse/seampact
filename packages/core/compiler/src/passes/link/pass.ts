import type { WorkspacePass } from "../../pipeline/seam.js";
import { linkRelaySuperset } from "./relays.js";

// The link pass (ADR 0006 section 3): diagnostics only, over the derived draft of every api, the `relays` superset.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const linkPass: WorkspacePass = {
  name: "link",
  reads: [
    "operations",
    "operations[].id",
    "operations[].kind",
    "operations[].origin",
    "operations[].relays",
    "operations[].errors",
  ],
  run: (apis, context) => linkRelaySuperset(apis, context),
};
