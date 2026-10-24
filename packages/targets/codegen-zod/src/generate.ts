import type { GeneratedFile, GenerateInput, GenerateOutcome } from "@seampact/codegen-core";
import {
  indexFile,
  type ModuleSource,
  moduleContents,
  modulePath,
  OPERATION_INPUT_MODULE,
  planValidators,
  SCHEMA_MODULES,
  type ValidatorsOptions,
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
  input: GenerateInput<ValidatorsOptions, ValidatorsArtefact, never>,
): GenerateOutcome {
  if (!input.artefacts.has(VALIDATORS_ARTEFACT)) return { status: "generated", files: [] };

  const planned = planValidators(input.ir);

  if (planned.status === "refused") return planned;

  const { plan } = planned;
  const modules: { module: string; source: ModuleSource }[] = [
    {
      module: SCHEMA_MODULES.input,
      source: schemaModuleSource(plan.schemaModules.input, input.options.rules),
    },
    {
      module: SCHEMA_MODULES.output,
      source: schemaModuleSource(plan.schemaModules.output, input.options.rules),
    },
    {
      module: OPERATION_INPUT_MODULE,
      source: operationInputModuleSource(plan.operationInputs, input.options.rules),
    },
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
