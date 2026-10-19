import type {
  BodyPlan,
  FieldPlan,
  ModuleSource,
  ObjectPlan,
  OperationInputPlan,
  UnknownKeys,
} from "@seampact/codegen-core/validators";
import { type DtoRenderContext, fieldDeclaration, nestedDtoDeclaration } from "./dto-field.js";
import { classDeclaration, type DtoModuleSource } from "./dto-module.js";
import {
  ADAPTER_IMPORT,
  CONSTRAINTS_IMPORT,
  DTO_MODULES,
  DTO_NAMESPACES,
  dtoClassName,
  requestClassName,
} from "./layout.js";
import { LibraryImports } from "./library-imports.js";

const INPUT_DTOS = { name: DTO_NAMESPACES.input, module: DTO_MODULES.input };

// The adapter drops undeclared path and header members before validating, and the query refuses them, as the
// plan's policies say.
const PART_POLICIES = {
  path: "strip",
  query: "refuse",
  headers: "strip",
} as const satisfies Record<string, UnknownKeys>;

// The request DTO of each planned operation, `{ path, query, headers, body }` as the operation declares them,
// and its input adapter.
export function operationInputModuleSource(plans: readonly OperationInputPlan[]): DtoModuleSource {
  const imports = new LibraryImports();
  let usesInputDtos = false;

  const context: DtoRenderContext = {
    referToDto(_schemaId, exportName) {
      usesInputDtos = true;

      return `${INPUT_DTOS.name}.${dtoClassName(exportName)}`;
    },
    validator: (name) => imports.validator(name),
    transformer: (name) => imports.transformer(name),
  };

  const declarations = plans.flatMap((plan) => operationDeclarations(plan, context));

  return {
    source: {
      declarations,
      wireChecks: new Set(),
      namespaces: [ADAPTER_IMPORT, CONSTRAINTS_IMPORT, ...(usesInputDtos ? [INPUT_DTOS] : [])],
    },
    libraryImports: imports.importLines(),
  };
}

function operationDeclarations(plan: OperationInputPlan, context: DtoRenderContext): string[] {
  const declarations: string[] = [];
  const requestMembers: string[] = [];

  const addPart = (key: keyof typeof PART_POLICIES, part: string, object: ObjectPlan): void => {
    requireUnknownKeys(plan, key, object, PART_POLICIES[key]);

    const className = requestClassName(plan.exportName, part);

    declarations.push(classDeclaration(className, objectMembers(object.fields, context)));
    requestMembers.push(nestedDtoDeclaration(key, className, context));
  };

  if (plan.path !== undefined) addPart("path", "Path", plan.path);

  addPart("query", "Query", plan.query);

  if (plan.headers !== undefined) addPart("headers", "Headers", plan.headers);

  if (plan.body !== undefined) {
    const body = bodyMember(plan, plan.body, context);

    declarations.push(...body.declarations);
    requestMembers.push(body.member);
  }

  const requestClass = requestClassName(plan.exportName);
  const parts = [
    ...(plan.path === undefined ? [] : [`path: ${declaredNames(plan.path)}`]),
    ...(plan.headers === undefined ? [] : [`headers: ${declaredNames(plan.headers)}`]),
    `body: ${plan.body !== undefined}`,
  ];

  declarations.push(classDeclaration(requestClass, requestMembers));
  declarations.push(
    `export const ${plan.exportName} = ${ADAPTER_IMPORT.name}.requestSchema(${requestClass}, { ${parts.join(", ")} });`,
  );

  return declarations;
}

// The body: the input schema's DTO, or a subclass of it adding the rule proofs' body fields, which keeps every
// check of the schema.
function bodyMember(
  plan: OperationInputPlan,
  body: BodyPlan,
  context: DtoRenderContext,
): { declarations: string[]; member: string } {
  if (body.proofFields.length === 0) {
    return {
      declarations: [],
      member: fieldDeclaration({ key: "body", type: body.type, optional: false }, context),
    };
  }

  if (body.type.kind !== "schema") {
    throw new Error(
      "codegen-class-validator: proof fields beside a body that is not an object schema reached the renderer; the plan refuses them.",
    );
  }

  const className = requestClassName(plan.exportName, "Body");
  const schemaClass = context.referToDto(body.type.schemaId, body.type.exportName);

  return {
    declarations: [
      classDeclaration(className, objectMembers(body.proofFields, context), schemaClass),
    ],
    member: nestedDtoDeclaration("body", className, context),
  };
}

function objectMembers(fields: readonly FieldPlan[], context: DtoRenderContext): string[] {
  return fields.map((field) => fieldDeclaration(field, context));
}

function declaredNames(object: ObjectPlan): string {
  return JSON.stringify(object.fields.map((field) => field.key));
}

function requireUnknownKeys(
  plan: OperationInputPlan,
  part: string,
  object: ObjectPlan,
  expected: UnknownKeys,
): void {
  if (object.unknownKeys === expected) return;

  throw new Error(
    `codegen-class-validator: the ${part} of '${plan.operationId}' is planned to ${object.unknownKeys} unknown keys; the request adapter can only ${expected} them.`,
  );
}
