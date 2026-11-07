import type { DraftIR, PassContextOf, PassPart } from "../../../pipeline/seam.js";
import { deriveWireApiWire } from "./api-wire.js";
import { deriveWireBodyHeaders } from "./bodies.js";
import { deriveWireBodyLimit } from "./body-limit.js";
import { deriveWireBucketLimits } from "./buckets.js";
import { deriveWireCache, deriveWireReportSettingFaults } from "./cache.js";
import { deriveWireConcurrency } from "./concurrency.js";
import { deriveWireCredentials } from "./credentials.js";
import { deriveWireHeaderTag } from "./header-tag.js";
import {
  type DeriveWireExemptions,
  deriveWireCheckExemptions,
  deriveWireIdempotency,
  deriveWireIdempotencyConvention,
} from "./idempotency.js";
import { deriveWireIdentityHeaders } from "./identity-headers.js";
import { deriveWireDeprecation, deriveWireMaturity } from "./lifecycle.js";
import { deriveWirePaging } from "./paging.js";
import { deriveWireReporter } from "./report.js";
import { type DeriveWireScope, deriveWireRoutes } from "./routes.js";
import { deriveWireUnknownKeys, deriveWireUnknownKeysPolicy } from "./unknown-keys.js";

// The derive.wire half (ADR 0006 sections 2 and 3): the api's wire conventions (`api.wire`) and the wire members
// the derivation table gives to `derive.wire` (`derivations/table.ts`), each with its `derivedFrom`. Every route, a
// relay route included, derives its own boundary from its own node and access; a relay route reads from the
// operation it relays only the version parameter and `ETag` headers, since it has no resource of its own
// (`concurrency.ts`). The derived parameters of a route are written in the derivation table's order, then source order.
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
    "operations[].concurrency.version",
    "operations[].concurrency.field",
    "pagings",
    "operations[].paging.style",
    "operations[].paging.maxLimit",
    "operations[].paging.overLimit",
    "operations[].paging.token",
    "operations[].paging.origin",
    "operations[].paging.sortKeys[].key",
    "api",
    "services",
    "operations[].deprecated",
    "operations[].upstream",
    "operations[].maturity",
    "buckets",
  ],
  writes: [
    "api.wire",
    "operations[].params.query",
    "operations[].params.header",
    "operations[].responses[].headers",
    "operations[].input.bodyLimitBytes",
    "operations[].input.schema.unknownKeys",
    "operations[].idempotency",
    "operations[].deadlineHeader",
    "operations[].concurrency.derivedFrom",
    "operations[].cache",
    "operations[].responses",
    "operations[].maturity",
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
    settingFaults: new Map(),
  };
  const unknownKeys = deriveWireUnknownKeysPolicy(scope);
  const idempotency = deriveWireIdempotencyConvention(scope);
  const exemptions: DeriveWireExemptions = { used: new Set() };

  deriveWireApiWire(scope);
  deriveWireBucketLimits(scope);

  for (const route of deriveWireRoutes(draft, context)) {
    deriveWireBodyLimit(route, scope);
    deriveWireUnknownKeys(route, unknownKeys);
    deriveWireCredentials(route, scope);
    deriveWireIdempotency(route, idempotency, exemptions, scope);
    deriveWireConcurrency(route, scope);
    deriveWireIdentityHeaders(route, scope);
    deriveWireHeaderTag(route, scope);
    deriveWireCache(route, scope);
    deriveWirePaging(route, scope);
    deriveWireDeprecation(route, scope);
    deriveWireMaturity(route, scope);
    deriveWireBodyHeaders(route, scope);
  }

  deriveWireCheckExemptions(idempotency, exemptions, scope);
  deriveWireReportSettingFaults(scope);
}
