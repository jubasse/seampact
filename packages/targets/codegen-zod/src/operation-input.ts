import {
  type BodyPlan,
  type ModuleSource,
  type OperationInputPlan,
  type RulesMode,
  SCHEMA_MODULES,
  type WireCheck,
} from "@seampact/codegen-core/validators";
import {
  fieldMembers,
  objectExpression,
  validatorExpression,
  type ZodRenderContext,
} from "./validator-expression.js";

// The namespace the module imports the input schema validators under; validator exports end in `Schema`, so
// none can take it.
const INPUT_SCHEMAS_NAMESPACE = "inputSchemas";

// The zod input validator of each planned operation, a `z.object` of its request members.
export function operationInputModuleSource(
  plans: readonly OperationInputPlan[],
  rules: RulesMode,
): ModuleSource {
  const wireChecks = new Set<WireCheck>();
  let usesInputSchemas = false;

  const context: ZodRenderContext = {
    rules,
    referToSchema(_schemaId, exportName) {
      usesInputSchemas = true;

      return `${INPUT_SCHEMAS_NAMESPACE}.${exportName}`;
    },
    wireCheck(check) {
      wireChecks.add(check);

      return check;
    },
  };

  const declarations = plans.map((plan) => operationDeclaration(plan, context));

  return {
    declarations,
    wireChecks,
    namespaces: usesInputSchemas
      ? [{ name: INPUT_SCHEMAS_NAMESPACE, module: SCHEMA_MODULES.input }]
      : [],
  };
}

function operationDeclaration(plan: OperationInputPlan, context: ZodRenderContext): string {
  const members: string[] = [];

  if (plan.path !== undefined) members.push(`path: ${objectExpression(plan.path, context)},`);

  members.push(`query: ${objectExpression(plan.query, context)},`);

  if (plan.headers !== undefined) {
    members.push(`headers: ${objectExpression(plan.headers, context)},`);
  }

  if (plan.body !== undefined) members.push(`body: ${bodyValidator(plan.body, context)},`);

  return `export const ${plan.exportName} = z.object({\n${members.join("\n")}\n});`;
}

// `.extend` keeps the schema's strictness.
function bodyValidator(body: BodyPlan, context: ZodRenderContext): string {
  const schemaValidator = validatorExpression(body.type, context);

  if (body.proofFields.length === 0) return schemaValidator;

  return `${schemaValidator}.extend({\n${fieldMembers(body.proofFields, context)}\n})`;
}
