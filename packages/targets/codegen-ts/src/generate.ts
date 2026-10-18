import {
  below,
  type GeneratedFile,
  type GenerateInput,
  type GenerateOutcome,
  type IrLocation,
  type NoOptions,
  operationLocation,
  type Refusal,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "@seampact/codegen-core";
import type { ContractIR, Operation } from "@seampact/spec/ir";
import {
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

// The schemas module and the three operation modules, or every refusal at once: a form the slice does not use
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

// The api index: the schemas under `schemas`, the three operation modules flat, so `import * as Tasks from "<out>"`
// reaches every name.
function indexFile(files: readonly GeneratedFile[]): GeneratedFile[] {
  const lines = files.map((file) => {
    const specifier = `./${file.path.slice(0, -MODULE_EXTENSION.length)}.js`;

    return file.path === `${SCHEMAS_MODULE}${MODULE_EXTENSION}`
      ? `export * as ${SCHEMAS_NAMESPACE} from "${specifier}";`
      : `export * from "${specifier}";`;
  });

  if (lines.length === 0) return [];

  return [{ path: `${INDEX_MODULE}${MODULE_EXTENSION}`, contents: `${lines.join("\n")}\n` }];
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
