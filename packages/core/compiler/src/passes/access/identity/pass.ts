import type { DraftIR, PassContextOf, PassPart } from "../../../pipeline/seam.js";
import { accessIdentityHeaders } from "./headers.js";
import { accessIdentityIdentities } from "./identities.js";
import { accessIdentityOperations } from "./operations.js";
import { accessIdentityReporter } from "./report.js";
import { accessIdentitySchemeKinds, accessIdentitySchemes } from "./schemes.js";

// The access.identity half (ADR 0006 sections 2 and 3): the `schemes`, `headers` and `identities` catalogues, who
// may call each operation and the facts of its input that access decides, and their checks. It reads `schemas` for
// the principal schemas and input fields tree.schemas wrote, and the operations tree.nodes wrote.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const accessIdentityPass: PassPart<"access.identity"> = {
  pass: "access",
  half: "access.identity",
  reads: [
    "schemas",
    "operations",
    "operations[].id",
    "operations[].safe",
    "operations[].params",
    "operations[].input.schema",
    "operations[].origin",
  ],
  writes: [
    "schemes",
    "headers",
    "identities",
    "operations[].access",
    "operations[].callerKinds",
    "operations[].principalRequires",
    "operations[].bindings",
    "operations[].csrf",
    "operations[].input.rawBody",
    "operations[].input.schema.unknownKeys",
  ],
  run: (draft, context) => {
    accessIdentityPassRun(draft, context);
  },
};

function accessIdentityPassRun(draft: DraftIR, context: PassContextOf<"access.identity">): void {
  const reporter = accessIdentityReporter(context);
  const schemeKinds = accessIdentitySchemeKinds(context);
  const schemes = accessIdentitySchemes(context, schemeKinds, reporter);
  const headers = accessIdentityHeaders(context, reporter);
  const identities = accessIdentityIdentities(
    context,
    { schemeKinds, headers, schemas: draft.schemas },
    reporter,
  );

  for (const [id, scheme] of schemes) draft.schemes[id] = scheme;

  for (const [id, header] of headers) draft.headers[id] = header.declaration;

  for (const [id, identity] of identities) draft.identities[id] = identity;

  accessIdentityOperations(draft, context, { schemes, identities }, reporter);
}
