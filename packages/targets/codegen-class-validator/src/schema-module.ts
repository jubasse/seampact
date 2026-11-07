import type { SchemaDirection } from "@seampact/codegen-core";
import type { ModuleSource, SchemaPlan } from "@seampact/codegen-core/validators";
import { ADAPTER_IMPORT, DTO_MODULES, DTO_NAMESPACES, dtoClassName } from "./layout.js";

// The Standard Schema adapter of each schema planned in one direction, built once at module load over its DTO.
export function schemaModuleSource(
  direction: SchemaDirection,
  plans: readonly SchemaPlan[],
): ModuleSource {
  const dtos = DTO_NAMESPACES[direction];

  const declarations = plans.map(
    (plan) =>
      `export const ${plan.exportName} = ${ADAPTER_IMPORT.name}.dtoSchema(${dtos}.${dtoClassName(plan.exportName)}, ${JSON.stringify(direction)});`,
  );

  return {
    declarations,
    wireChecks: new Set(),
    namespaces: [ADAPTER_IMPORT, { name: dtos, module: DTO_MODULES[direction] }],
  };
}
