import {
  type BodyPlan,
  type ModuleSource,
  type OperationInputPlan,
  type RulesMode,
  SCHEMA_MODULES,
} from "@seampact/codegen-core/validators";
import { ModuleRendering, type YupRenderContext } from "./module-rendering.js";
import { fieldMembers, objectExpression, validatorExpression } from "./validator-expression.js";
import { STANDARD_SCHEMA_OF } from "./yup-support.js";

// The namespace the module imports the input schema validators under; validator exports end in `Schema`, so
// none can take it.
const INPUT_SCHEMAS_NAMESPACE = "inputSchemas";

// The yup input validator of each planned operation, a Standard Schema over a `yup.object` of its request members.
export function operationInputModuleSource(
  plans: readonly OperationInputPlan[],
  rules: RulesMode,
): ModuleSource & { supportNames: ReadonlySet<string> } {
  let usesInputSchemas = false;

  const rendering = new ModuleRendering(rules, (_schemaId, exportName) => {
    usesInputSchemas = true;

    return `${INPUT_SCHEMAS_NAMESPACE}.${exportName}`;
  });

  const declarations = plans.map((plan) => operationDeclaration(plan, rendering));

  if (usesInputSchemas) {
    rendering.namespaces.push({ name: INPUT_SCHEMAS_NAMESPACE, module: SCHEMA_MODULES.input });
  }

  return { ...rendering.source(declarations), supportNames: rendering.supportNames };
}

// Path and headers keep only their declared keys; no member is cast, so the object itself is not strict.
function operationDeclaration(plan: OperationInputPlan, context: YupRenderContext): string {
  const members: string[] = [];

  if (plan.path !== undefined) {
    members.push(`path: ${objectExpression(plan.path, context)}.defined(),`);
  }

  members.push(`query: ${objectExpression(plan.query, context)}.defined(),`);

  if (plan.headers !== undefined) {
    members.push(`headers: ${objectExpression(plan.headers, context)}.defined(),`);
  }

  if (plan.body !== undefined)
    members.push(`body: ${bodyValidator(plan.body, context)}.defined(),`);

  return `export const ${plan.exportName} = ${context.supportName(STANDARD_SCHEMA_OF)}(yup.object({\n${members.join("\n")}\n}));`;
}

// `.shape` adds the proof fields and keeps the schema's strictness and its unknown keys test.
function bodyValidator(body: BodyPlan, context: YupRenderContext): string {
  const schemaValidator = validatorExpression(body.type, context);

  if (body.proofFields.length === 0) return schemaValidator;

  return `${schemaValidator}.shape({\n${fieldMembers(body.proofFields, context)}\n})`;
}
