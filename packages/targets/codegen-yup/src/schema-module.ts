import type { ModuleSource, SchemaPlan } from "@seampact/codegen-core/validators";
import { ModuleRendering } from "./module-rendering.js";
import { objectExpression } from "./validator-expression.js";

// The yup validators of the schemas planned in one direction, in the plan's dependency order.
export function schemaModuleSource(
  plans: readonly SchemaPlan[],
): ModuleSource & { supportNames: ReadonlySet<string> } {
  const rendering = new ModuleRendering((_schemaId, exportName) => exportName);

  const declarations = plans.map(
    (plan) => `export const ${plan.exportName} = ${objectExpression(plan.object, rendering)};`,
  );

  return { ...rendering.source(declarations), supportNames: rendering.supportNames };
}
