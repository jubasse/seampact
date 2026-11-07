import {
  apiIndexSource,
  below,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IndexedModule,
  type IrLocation,
  type NoOptions,
  operationLocation,
  type Refusal,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "@seampact/codegen-core";
import type { ContractIR, Operation } from "@seampact/spec/ir";
import { apiConstantsSource } from "./api-constants.js";
import {
  API_CONSTANTS_MODULE,
  INDEX_MODULE,
  MODULE_EXTENSION,
  OPERATION_ERRORS_MODULE,
  OPERATION_INPUT_MODULE,
  OPERATION_OUTPUT_MODULE,
  planTypesLayout,
  SCHEMAS_MODULE,
  SCHEMAS_NAMESPACE,
  type TypesLayout,
} from "./layout.js";
import { operationModuleContext } from "./module-context.js";
import { operationErrorsDeclaration } from "./operation-errors.js";
import { operationInputDeclaration } from "./operation-input.js";
import { operationOutputDeclaration } from "./operation-output.js";
import { schemasModuleSource } from "./schemas-module.js";
import type { TypeContext } from "./type-expression.js";

export const TYPES_ARTEFACT = "types";

export type TypesArtefact = typeof TYPES_ARTEFACT;

type OperationDeclaration = (
  operation: Operation,
  location: IrLocation,
  context: TypeContext,
) => string;

const OPERATION_MODULES: readonly { module: string; declaration: OperationDeclaration }[] = [
  { module: OPERATION_INPUT_MODULE, declaration: operationInputDeclaration },
  { module: OPERATION_OUTPUT_MODULE, declaration: operationOutputDeclaration },
  { module: OPERATION_ERRORS_MODULE, declaration: operationErrorsDeclaration },
];

// The schemas module, the three operation modules and the api constants, or every refusal at once: a form the slice does not use
// is refused by name, never approximated (A47).
export function generateTypes(
  input: GenerateInput<NoOptions, TypesArtefact, never>,
): GenerateOutcome {
  if (!input.artefacts.has(TYPES_ARTEFACT)) return { status: "generated", files: [] };

  const { ir } = input;
  const planned = planTypesLayout(ir);

  if (planned.status === "refused") return planned;

  const refusals: Refusal[] = [];

  refuseApiForms(ir, refusals);

  const files = [
    ...schemasFile(ir, planned.layout, refusals),
    ...(ir.operations.length === 0 ? [] : operationFiles(ir, planned.layout, refusals)),
    ...apiConstantsFile(ir, refusals),
  ];

  if (refusals.length > 0) return { status: "refused", refusals };

  return { status: "generated", files: [...files, ...indexFile(files)] };
}

function refuseApiForms(ir: ContractIR, refusals: Refusal[]): void {
  const outputEnums = ir.api.wire.outputEnums;
  const location = below({ member: "" }, "api", "wire", "outputEnums");

  if (outputEnums === "open") {
    refusals.push(refuseNotGeneratedYet("wire.outputEnums.open", "Open output enums", location));
  } else if (outputEnums !== "enum") {
    refusals.push(refuseUnknownValueAt(location, outputEnums));
  }
}

function schemasFile(ir: ContractIR, layout: TypesLayout, refusals: Refusal[]): GeneratedFile[] {
  const source = schemasModuleSource({
    ir,
    layout,
    refusals,
    referToNamedType: (typeName) => typeName,
  });

  if (source === "") return [];

  return [{ path: `${SCHEMAS_MODULE}${MODULE_EXTENSION}`, contents: `${source}\n` }];
}

// The api index: the schemas under `schemas`, the operation modules and the constants flat, so `import * as
// Tasks from "<out>/index.js"` reaches every name.
function indexFile(files: readonly GeneratedFile[]): GeneratedFile[] {
  if (files.length === 0) return [];

  const modules = files.map((file): IndexedModule => {
    const module = file.path.slice(0, -MODULE_EXTENSION.length);

    return module === SCHEMAS_MODULE ? { module, namespace: SCHEMAS_NAMESPACE } : { module };
  });

  return [{ path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: apiIndexSource(modules) }];
}

function operationFiles(ir: ContractIR, layout: TypesLayout, refusals: Refusal[]): GeneratedFile[] {
  return OPERATION_MODULES.map(({ module, declaration }) => {
    const { context, importLines } = operationModuleContext(ir, layout, refusals);
    const declarations = ir.operations.map((operation, index) =>
      declaration(operation, operationLocation(index, operation.id), context),
    );
    const contents = [...importLines(module), ...declarations].join("\n\n");

    return { path: `${module}${MODULE_EXTENSION}`, contents: `${contents}\n` };
  });
}

// The `Status` and `ErrorCode` constants, once the api has an operation or an error code to name.
function apiConstantsFile(ir: ContractIR, refusals: Refusal[]): GeneratedFile[] {
  if (ir.operations.length === 0 && Object.keys(ir.errors).length === 0) return [];

  return [
    {
      path: `${API_CONSTANTS_MODULE}${MODULE_EXTENSION}`,
      contents: `${apiConstantsSource(ir, refusals)}\n`,
    },
  ];
}
