import type { SchemaDirection, ValidatorStyle } from "@seampact/codegen-core";

// The class-validator target writes the shared validators layout of `@seampact/codegen-core/validators`, where
// every export is a Standard Schema adapter over a DTO class, beside the DTO modules and its copied runtime.
export { SCHEMA_MODULES, SCHEMA_NAMESPACES } from "@seampact/codegen-core/validators";

export const CLASS_VALIDATOR_STYLE: ValidatorStyle = "class-validator";

export const DTO_MODULES: Readonly<Record<SchemaDirection, string>> = {
  input: "dtos/input",
  output: "dtos/output",
};

// The two DTO modules export the same `<TypeName>Dto` names, so the index groups each under its direction.
export const DTO_NAMESPACES: Readonly<Record<SchemaDirection, string>> = {
  input: "inputDtos",
  output: "outputDtos",
};

// The copied runtime modules a generated module imports, each under a namespace no generated name can take:
// generated exports end in `Dto` or `Schema`.
export const CONSTRAINTS_IMPORT = { name: "contract", module: "constraints" } as const;
export const ADAPTER_IMPORT = { name: "adapter", module: "class-validator-schema" } as const;

const VALIDATOR_SUFFIX = "Schema";
const OPERATION_VALIDATOR_SUFFIX = `Input${VALIDATOR_SUFFIX}`;
const DTO_SUFFIX = "Dto";

// `TaskSchema` validates through `TaskDto`.
export function dtoClassName(validatorExportName: string): string {
  return `${withoutSuffix(validatorExportName, VALIDATOR_SUFFIX)}${DTO_SUFFIX}`;
}

// `GetTaskInputSchema` validates through `GetTaskRequestDto`, its parts through `GetTaskRequest<Part>Dto`.
export function requestClassName(operationExportName: string, part = ""): string {
  return `${withoutSuffix(operationExportName, OPERATION_VALIDATOR_SUFFIX)}Request${part}${DTO_SUFFIX}`;
}

function withoutSuffix(name: string, suffix: string): string {
  if (!name.endsWith(suffix)) {
    throw new Error(
      `codegen-class-validator: the planned validator name '${name}' does not end in '${suffix}'.`,
    );
  }

  return name.slice(0, -suffix.length);
}
