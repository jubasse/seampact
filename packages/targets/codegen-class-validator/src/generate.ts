import {
  apiIndexSource,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IndexedModule,
  type SchemaDirection,
  withoutRepeats,
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
  type ValidatorsOptions,
  WIRE_CHECKS_MODULE,
  WIRE_CHECKS_SOURCE,
} from "@seampact/codegen-core/validators";
import { dtoModuleSource } from "./dto-module.js";
import { refuseDtoForms } from "./dto-refusals.js";
import { DTO_MODULES, DTO_NAMESPACES } from "./layout.js";
import { operationInputModuleSource } from "./operation-input.js";
import { validatorRuntimeFiles } from "./runtime-files.js";
import { schemaModuleSource } from "./schema-module.js";

export const VALIDATORS_ARTEFACT = "validators";

export type ValidatorsArtefact = typeof VALIDATORS_ARTEFACT;

const DIRECTIONS: readonly SchemaDirection[] = ["input", "output"];

interface PlannedModule {
  readonly module: string;
  readonly source: ModuleSource;
  readonly libraryImports: string;
}

// The DTO classes and schema adapters of each direction, the request DTO and adapter of each operation, and the
// copied runtime they share, or every refusal at once: a form the slice does not use is refused by name, never
// approximated (A47).
export function generateValidators(
  input: GenerateInput<ValidatorsOptions, ValidatorsArtefact, never>,
): GenerateOutcome {
  if (!input.artefacts.has(VALIDATORS_ARTEFACT)) return { status: "generated", files: [] };

  const planned = planValidators(input.ir);
  const dtoRefusals = refuseDtoForms(input.ir);
  const refusals = [...(planned.status === "refused" ? planned.refusals : []), ...dtoRefusals];

  if (planned.status === "refused" || refusals.length > 0) {
    return { status: "refused", refusals: withoutRepeats(refusals) };
  }

  const { plan } = planned;
  const modules: PlannedModule[] = DIRECTIONS.flatMap((direction) => {
    const dtos = dtoModuleSource(direction, plan.schemaModules[direction], input.options.rules);

    return [
      { module: DTO_MODULES[direction], ...dtos },
      {
        module: SCHEMA_MODULES[direction],
        source: schemaModuleSource(direction, plan.schemaModules[direction]),
        libraryImports: "",
      },
    ];
  });

  modules.push({
    module: OPERATION_INPUT_MODULE,
    ...operationInputModuleSource(plan.operationInputs, input.options.rules),
  });

  const files: GeneratedFile[] = modules.flatMap(({ module, source, libraryImports }) => {
    const contents = moduleContents(module, source, libraryImports);

    return contents === undefined ? [] : [{ path: modulePath(module), contents }];
  });

  if (files.length === 0) return { status: "generated", files: [] };

  return {
    status: "generated",
    files: [
      ...files,
      ...validatorRuntimeFiles(),
      { path: modulePath(WIRE_CHECKS_MODULE), contents: WIRE_CHECKS_SOURCE },
      indexFile(files),
    ],
  };
}

// The api index: each DTO and schema module under its direction's namespace, the operation input adapters and
// request DTOs flat; the copied runtime stays internal.
function indexFile(files: readonly GeneratedFile[]): GeneratedFile {
  const written = new Set(files.map((file) => file.path));
  const directionModules = DIRECTIONS.flatMap((direction) => [
    { module: DTO_MODULES[direction], namespace: DTO_NAMESPACES[direction] },
    { module: SCHEMA_MODULES[direction], namespace: SCHEMA_NAMESPACES[direction] },
  ]);
  const modules: IndexedModule[] = [
    ...directionModules.filter(({ module }) => written.has(modulePath(module))),
    ...(written.has(modulePath(OPERATION_INPUT_MODULE))
      ? [{ module: OPERATION_INPUT_MODULE }]
      : []),
  ];

  return { path: modulePath(INDEX_MODULE), contents: apiIndexSource(modules) };
}
