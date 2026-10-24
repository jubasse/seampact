import type {
  ModuleSource,
  RulesMode,
  SchemaPlan,
  WireCheck,
} from "@seampact/codegen-core/validators";
import { objectExpression, type ZodRenderContext } from "./validator-expression.js";

// The zod validators of the schemas planned in one direction, in the plan's dependency order.
export function schemaModuleSource(plans: readonly SchemaPlan[], rules: RulesMode): ModuleSource {
  const wireChecks = new Set<WireCheck>();
  const context: ZodRenderContext = {
    rules,
    referToSchema: (_schemaId, exportName) => exportName,
    wireCheck(check) {
      wireChecks.add(check);

      return check;
    },
  };

  const declarations = plans.map(
    (plan) => `export const ${plan.exportName} = ${objectExpression(plan.object, context)};`,
  );

  return { declarations, wireChecks, namespaces: [] };
}
