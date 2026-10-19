import {
  apiIndexSource,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IndexedModule,
  type NoOptions,
} from "@seampact/codegen-core";
import {
  INDEX_MODULE,
  type ModuleSource,
  moduleContents,
  modulePath,
  OPERATION_INPUT_MODULE,
  planValidators,
  SCHEMA_MODULES,
  SCHEMA_NAMESPACES,
  WIRE_CHECKS_MODULE,
  WIRE_CHECKS_SOURCE,
} from "@seampact/codegen-core/validators";
import { ZOD_IMPORT } from "./layout.js";
import { operationInputModuleSource } from "./operation-input.js";
import { schemaModuleSource } from "./schema-module.js";

export const VALIDATORS_ARTEFACT = "validators";

export type ValidatorsArtefact = typeof VALIDATORS_ARTEFACT;

// The schema validators of each direction, the operation input validators and the code point counter they
// share, or every refusal at once: a form the slice does not use is refused by name, never approximated (A47).
export function generateValidators(
  input: GenerateInput<NoOptions, ValidatorsArtefact, never>,
): GenerateOutcome {
  if (!input.artefacts.has(VALIDATORS_ARTEFACT)) return { status: "generated", files: [] };

  const planned = planValidators(input.ir);

  if (planned.status === "refused") return planned;

  const { plan } = planned;
  const modules: { module: string; source: ModuleSource }[] = [
    { module: SCHEMA_MODULES.input, source: schemaModuleSource(plan.schemaModules.input) },
    { module: SCHEMA_MODULES.output, source: schemaModuleSource(plan.schemaModules.output) },
    { module: OPERATION_INPUT_MODULE, source: operationInputModuleSource(plan.operationInputs) },
  ];

  const files: GeneratedFile[] = modules.flatMap(({ module, source }) => {
    const contents = moduleContents(module, source, ZOD_IMPORT);

    return contents === undefined ? [] : [{ path: modulePath(module), contents }];
  });

  if (modules.some(({ source }) => source.wireChecks.size > 0)) {
    files.push({ path: modulePath(WIRE_CHECKS_MODULE), contents: WIRE_CHECKS_SOURCE });
  }

  return { status: "generated", files: [...files, ...indexFile(files)] };
}

// The api index: each schema module under its direction's namespace, the operation input validators flat, so
// `import * as Tasks from "<out>/index.js"` reaches every name; `wire-checks` stays internal.
function indexFile(files: readonly GeneratedFile[]): GeneratedFile[] {
  const written = new Set(files.map((file) => file.path));
  const schemaModules = (["input", "output"] as const).flatMap((direction) =>
    written.has(modulePath(SCHEMA_MODULES[direction]))
      ? [{ module: SCHEMA_MODULES[direction], namespace: SCHEMA_NAMESPACES[direction] }]
      : [],
  );
  const operationModules = written.has(modulePath(OPERATION_INPUT_MODULE))
    ? [{ module: OPERATION_INPUT_MODULE }]
    : [];
  const modules: IndexedModule[] = [...schemaModules, ...operationModules];

  if (modules.length === 0) return [];

  return [{ path: modulePath(INDEX_MODULE), contents: apiIndexSource(modules) }];
}
