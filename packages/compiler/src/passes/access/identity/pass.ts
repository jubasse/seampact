import type { DraftIR, PassContextOf, PassPart } from "../../../pipeline/seam.js";
import { accessIdentityHeaders } from "./headers.js";
import { accessIdentityIdentities } from "./identities.js";
import { accessIdentityEntries, accessIdentityString } from "./read.js";
import { accessIdentityReporter } from "./report.js";
import { accessIdentitySchemes } from "./schemes.js";

// The access.identity half (ADR 0006 sections 2 and 3): the `schemes`, `headers` and `identities` catalogues and
// their checks. It reads `schemas` for the principal schemas tree.schemas wrote.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const accessIdentityPass: PassPart<"access.identity"> = {
  pass: "access",
  half: "access.identity",
  reads: ["schemas"],
  writes: ["schemes", "headers", "identities"],
  run: (draft, context) => {
    accessIdentityCatalogues(draft, context);
  },
};

function accessIdentityCatalogues(draft: DraftIR, context: PassContextOf<"access.identity">): void {
  const reporter = accessIdentityReporter(context);
  const schemes = accessIdentitySchemes(context, reporter);
  const headers = accessIdentityHeaders(context, reporter);
  const schemeKinds = new Map(
    accessIdentityEntries(context.raw.merged, "schemes").map(([id, raw]) => [
      id,
      accessIdentityString(raw, "kind"),
    ]),
  );
  const identities = accessIdentityIdentities(
    context,
    { schemeKinds, headers, schemas: draft.schemas },
    reporter,
  );

  for (const [id, scheme] of schemes) draft.schemes[id] = scheme;
  for (const [id, header] of headers) draft.headers[id] = header.declaration;
  for (const [id, identity] of identities) draft.identities[id] = identity;
}
