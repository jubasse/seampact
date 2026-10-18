import type { PassPart } from "../../../pipeline/seam.js";
import { deriveErrorsCheckBindings } from "./bindings.js";
import { deriveErrorsNatures } from "./natures.js";
import { deriveErrorsRegistry } from "./registry.js";
import { deriveErrorsReporter } from "./report.js";

// The derive.errors half (ADR 0006 sections 2 and 3): the `natures` catalogue, the error registry (`errors`: the
// catalogue, the declarations on tree nodes and the default codes) and the checks of every role binding. It reads
// `schemas` for the params a bound code declares.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).
export const deriveErrorsPass: PassPart<"derive.errors"> = {
  pass: "derive",
  half: "derive.errors",
  reads: ["schemas"],
  writes: ["errors", "natures"],
  run: (draft, context) => {
    const reporter = deriveErrorsReporter(context);
    const natures = deriveErrorsNatures(context, reporter);

    for (const [id, nature] of natures) draft.natures[id] = nature;

    const registry = deriveErrorsRegistry({ context, reporter, natures });

    for (const [code, registered] of registry) draft.errors[code] = registered.declaration;

    deriveErrorsCheckBindings({ context, reporter, registry, schemas: draft.schemas });
  },
};
