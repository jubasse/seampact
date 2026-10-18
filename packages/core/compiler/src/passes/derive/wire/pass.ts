import type { DraftIR, PassContextOf, PassPart } from "../../../pipeline/seam.js";
import { deriveWireBodyLimit } from "./body-limit.js";
import { deriveWireCredentials } from "./credentials.js";
import { deriveWireHeaderTag } from "./header-tag.js";
import {
  type DeriveWireExemptions,
  deriveWireCheckExemptions,
  deriveWireIdempotency,
  deriveWireIdempotencyConvention,
} from "./idempotency.js";
import { deriveWireIdentityHeaders } from "./identity-headers.js";
import { deriveWireReporter } from "./report.js";
import { type DeriveWireScope, deriveWireRoutes } from "./routes.js";
import { deriveWireUnknownKeys, deriveWireUnknownKeysPolicy } from "./unknown-keys.js";

// The derive.wire half (ADR 0006 sections 2 and 3): the wire members the derivation table gives to `derive.wire`
// (`derivations/table.ts`), each with its `derivedFrom`. Every route, a relay route included, derives its own
// boundary from its own node and access: nothing is copied from the operation a relay route relays. The derived
// parameters of a route are written in the derivation table's order, then source order.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const deriveWirePass: PassPart<"derive.wire"> = {
  pass: "derive",
  half: "derive.wire",
  reads: [
    "schemas",
    "schemes",
    "headers",
    "identities",
    "operations",
    "operations[].id",
    "operations[].method",
    "operations[].safe",
    "operations[].origin",
    "operations[].access",
    "operations[].csrf",
    "operations[].params",
    "operations[].responses",
    "operations[].input",
    "operations[].input.schema",
  ],
  writes: [
    "operations[].params.query",
    "operations[].params.header",
    "operations[].responses[].headers",
    "operations[].input.bodyLimitBytes",
    "operations[].input.schema.unknownKeys",
    "operations[].idempotency",
    "operations[].deadlineHeader",
  ],
  run: (draft, context) => {
    deriveWirePassRun(draft, context);
  },
};

function deriveWirePassRun(draft: DraftIR, context: PassContextOf<"derive.wire">): void {
  const scope: DeriveWireScope = {
    draft,
    context,
    reporter: deriveWireReporter(context),
    reportedCollisions: new Set(),
  };
  const unknownKeys = deriveWireUnknownKeysPolicy(scope);
  const idempotency = deriveWireIdempotencyConvention(scope);
  const exemptions: DeriveWireExemptions = { used: new Set() };

  for (const route of deriveWireRoutes(draft, context)) {
    deriveWireBodyLimit(route, scope);
    deriveWireUnknownKeys(route, unknownKeys);
    deriveWireCredentials(route, scope);
    deriveWireIdempotency(route, idempotency, exemptions, scope);
    deriveWireIdentityHeaders(route, scope);
    deriveWireHeaderTag(route, scope);
  }

  deriveWireCheckExemptions(idempotency, exemptions, scope);
}
