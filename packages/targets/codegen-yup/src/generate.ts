import {
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type NoOptions,
  relativeModuleSpecifier,
} from "@seampact/codegen-core";
import {
  indexFile,
  type ModuleSource,
  moduleContents,
  modulePath,
  OPERATION_INPUT_MODULE,
  SCHEMA_MODULES,
  WIRE_CHECKS_MODULE,
  WIRE_CHECKS_SOURCE,
} from "@seampact/codegen-core/validators";
import { YUP_IMPORT } from "./layout.js";
import { operationInputModuleSource } from "./operation-input.js";
import { planYupValidators } from "./path-keys.js";
import { schemaModuleSource } from "./schema-module.js";
import { YUP_SUPPORT_MODULE, YUP_SUPPORT_SOURCE } from "./yup-support.js";

export const VALIDATORS_ARTEFACT = "validators";

export type ValidatorsArtefact = typeof VALIDATORS_ARTEFACT;

// The schema validators of each direction, the operation input validators and the code point counter they
// share, or every refusal at once: a form the slice does not use is refused by name, never approximated (A47).
export function generateValidators(
  input: GenerateInput<NoOptions, ValidatorsArtefact, never>,
): GenerateOutcome {
  if (!input.artefacts.has(VALIDATORS_ARTEFACT)) return { status: "generated", files: [] };

  const planned = planYupValidators(input.ir);

  if (planned.status === "refused") return planned;

  const { plan } = planned;

  const modules: { module: string; source: RenderedModule }[] = [
    { module: SCHEMA_MODULES.input, source: schemaModuleSource(plan.schemaModules.input) },
    { module: SCHEMA_MODULES.output, source: schemaModuleSource(plan.schemaModules.output) },
    { module: OPERATION_INPUT_MODULE, source: operationInputModuleSource(plan.operationInputs) },
  ];

  const files: GeneratedFile[] = modules.flatMap(({ module, source }) => {
    const contents = moduleContents(module, source, libraryImports(module, source.supportNames));

    return contents === undefined ? [] : [{ path: modulePath(module), contents }];
  });

  if (modules.some(({ source }) => source.wireChecks.size > 0)) {
    files.push({ path: modulePath(WIRE_CHECKS_MODULE), contents: WIRE_CHECKS_SOURCE });
  }

  if (modules.some(({ source }) => source.supportNames.size > 0)) {
    files.push({ path: modulePath(YUP_SUPPORT_MODULE), contents: YUP_SUPPORT_SOURCE });
  }

  return { status: "generated", files: [...files, ...indexFile(files)] };
}

type RenderedModule = ModuleSource & { supportNames: ReadonlySet<string> };

// The yup import first, then the names the module takes from the shared support.
function libraryImports(module: string, supportNames: ReadonlySet<string>): string {
  if (supportNames.size === 0) return YUP_IMPORT;

  const specifier = relativeModuleSpecifier(modulePath(module), YUP_SUPPORT_MODULE);

  return `${YUP_IMPORT}\nimport { ${[...supportNames].sort().join(", ")} } from "${specifier}";`;
}
