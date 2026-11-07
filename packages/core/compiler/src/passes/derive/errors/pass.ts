import type { PassPart } from "../../../pipeline/seam.js";
import { deriveErrorsCheckBindings } from "./bindings.js";
import { deriveErrorsCheckRouteExamples } from "./examples.js";
import { deriveErrorsNatures } from "./natures.js";
import { deriveErrorsOperations, deriveErrorsRoutes } from "./operations.js";
import { deriveErrorsRegistry } from "./registry.js";
import { deriveErrorsRelayCopies } from "./relays.js";
import { deriveErrorsReporter } from "./report.js";

// The derive.errors half (ADR 0006 sections 2 and 3): the `natures` catalogue, the error registry (`errors`: the
// catalogue, the declarations on tree nodes, the default codes and the relay routes' copies), the checks of every
// role binding and route error example, and each operation's `errors`. It reads `schemas` for the params a bound
// code declares and the sensitive values a code's params carry (`noStore`), the operation members the derivation
// table's triggers name, and the public operation a relay route relays.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const deriveErrorsPass: PassPart<"derive.errors"> = {
  pass: "derive",
  half: "derive.errors",
  reads: [
    "schemas",
    "api",
    "identities",
    "headers",
    "rights",
    "rules",
    "scopes",
    "pagings",
    "operations",
    "operations[].id",
    "operations[].origin",
    "operations[].safe",
    "operations[].resource",
    "operations[].params",
    "operations[].input",
    "operations[].access",
    "operations[].principalRequires",
    "operations[].bindings",
    "operations[].scopes",
    "operations[].requires",
    "operations[].fieldRights",
    "operations[].csrf",
    "operations[].idempotency",
    "operations[].concurrency",
    "operations[].owner",
    "operations[].paging",
    "operations[].deadlineHeader",
    "operations[].relays",
  ],
  writes: ["errors", "natures", "operations[].errors"],
  run: (draft, context) => {
    const reporter = deriveErrorsReporter(context);
    const natures = deriveErrorsNatures(context, reporter);

    for (const [id, nature] of natures) draft.natures[id] = nature;

    const registry = deriveErrorsRegistry({ context, reporter, natures, schemas: draft.schemas });

    for (const [code, registered] of registry) draft.errors[code] = registered.declaration;

    const check = { context, reporter, registry, schemas: draft.schemas };
    const bound = deriveErrorsCheckBindings(check);

    deriveErrorsCheckRouteExamples(check);

    const relayed = deriveErrorsRelayCopies(
      { context, reporter, registry, natures, schemas: draft.schemas },
      deriveErrorsRoutes({ context, draft }),
    );

    for (const [id, nature] of relayed.natures) draft.natures[id] = nature;

    for (const [code, copied] of relayed.errors) draft.errors[code] = copied.declaration;

    deriveErrorsOperations({
      ...check,
      registry: new Map([...registry, ...relayed.errors]),
      draft,
      bound,
      relayCodes: relayed.codes,
    });
  },
};
