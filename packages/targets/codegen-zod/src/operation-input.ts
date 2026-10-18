import type { Refusal } from "@seampact/codegen-core";
import {
  type ContractIR,
  isKnownVariant,
  type Operation,
  type OperationInput,
  type Param,
} from "@seampact/spec/ir";
import { below, type IrLocation, operationLocation } from "./ir-location.js";
import { requireName, SCHEMA_MODULES, type ValidatorsLayout } from "./layout.js";
import { CODE_POINT_LENGTH, type ModuleSource } from "./module-source.js";
import { propertyKey } from "./property-key.js";
import { refuseInconsistentIr, refuseNotGeneratedYet, refuseUnknownValueAt } from "./refusals.js";
import {
  REFUSED_VALIDATOR,
  type ValidatorContext,
  validatorExpression,
} from "./validator-expression.js";

// The namespace the module imports the input schema validators under; validator exports end in `Schema`, so
// none can take it.
const INPUT_SCHEMAS_NAMESPACE = "inputSchemas";

const JSON_MEDIA = "application/json";
const NOT_GENERATED_MEDIA: readonly string[] = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

// One validator per operation for the whole request, `{ path, query, headers, body }` after query decoding,
// each member present when the operation declares it: the one Standard Schema call of ADR 0012 "The check
// order" step 6. Path and query keys are wire names, header keys the lowercased wire names Node delivers.
export function operationInputModuleSource(
  ir: ContractIR,
  layout: ValidatorsLayout,
  refusals: Refusal[],
): ModuleSource {
  let usesCodePoints = false;
  let usesInputSchemas = false;

  const context: ValidatorContext = {
    ir,
    layout,
    refusals,
    direction: "input",
    referToSchema(_schemaId, exportName) {
      usesInputSchemas = true;

      return `${INPUT_SCHEMAS_NAMESPACE}.${exportName}`;
    },
    codePointLength() {
      usesCodePoints = true;

      return CODE_POINT_LENGTH;
    },
  };

  const declarations = ir.operations.map((operation, index) =>
    operationDeclaration(operation, operationLocation(index, operation.id), context),
  );

  return {
    declarations,
    usesCodePoints,
    namespaces: usesInputSchemas
      ? [{ name: INPUT_SCHEMAS_NAMESPACE, module: SCHEMA_MODULES.input }]
      : [],
  };
}

function operationDeclaration(
  operation: Operation,
  location: IrLocation,
  context: ValidatorContext,
): string {
  const paramsLocation = below(location, "params");
  const { path, query, header } = operation.params;
  const members: string[] = [];

  if (path.length > 0) {
    members.push(
      `path: ${paramsObject("z.object", path, (name) => name, below(paramsLocation, "path"), context)},`,
    );
  }

  if (query.length > 0) {
    const objectConstructor = queryConstructor(
      operation,
      below(location, "unknownQuery"),
      context.refusals,
    );

    members.push(
      `query: ${paramsObject(objectConstructor, query, (name) => name, below(paramsLocation, "query"), context)},`,
    );
  }

  if (header.length > 0) {
    const headerLocation = below(paramsLocation, "header");

    refuseDuplicateHeaders(header, headerLocation, context.refusals);
    members.push(
      `headers: ${paramsObject("z.object", header, (name) => name.toLowerCase(), headerLocation, context)},`,
    );
  }

  if (operation.input !== undefined) {
    members.push(`body: ${bodyValidator(operation.input, below(location, "input"), context)},`);
  }

  const exportName = requireName(context.layout.operationExportNames, operation.id);

  return `export const ${exportName} = z.object({\n${members.join("\n")}\n});`;
}

// Undeclared query keys are refused (`unknownQuery: refuse`); headers keep the unknown ones out by stripping.
function queryConstructor(operation: Operation, location: IrLocation, refusals: Refusal[]): string {
  const unknownQuery = operation.unknownQuery;

  if (!isKnownVariant("UnknownQuery", unknownQuery)) {
    refusals.push(refuseUnknownValueAt(below(location, "policy"), unknownQuery.policy));

    return REFUSED_VALIDATOR;
  }

  if (unknownQuery.policy === "ignore") {
    refusals.push(
      refuseNotGeneratedYet(
        "unknownQuery.ignore",
        "Ignoring unknown query keys",
        below(location, "policy"),
      ),
    );
  }

  return "z.strictObject";
}

function paramsObject(
  objectConstructor: string,
  params: readonly Param[],
  keyOf: (wireName: string) => string,
  location: IrLocation,
  context: ValidatorContext,
): string {
  const members = params.map((param, index) => {
    const paramLocation = below(location, index);

    if (param.default !== undefined) {
      context.refusals.push(
        refuseNotGeneratedYet(
          "param.default",
          "A parameter default",
          below(paramLocation, "default"),
        ),
      );
    }

    const validator = validatorExpression(param.type, below(paramLocation, "type"), context);

    return `${propertyKey(keyOf(param.name))}: ${validator}${param.required ? "" : ".optional()"},`;
  });

  return `${objectConstructor}({\n${members.join("\n")}\n})`;
}

function refuseDuplicateHeaders(
  headers: readonly Param[],
  location: IrLocation,
  refusals: Refusal[],
): void {
  const seen = new Set<string>();

  headers.forEach((header, index) => {
    const key = header.name.toLowerCase();

    if (seen.has(key)) {
      refusals.push(
        refuseInconsistentIr(
          "header.name.duplicate",
          `The header '${header.name}' is declared twice, compared without regard to case`,
          below(location, index, "name"),
        ),
      );
    }

    seen.add(key);
  });
}

// The JSON body: the input schema's validator, extended with the body fields of rule proofs (ADR 0004
// section 7); `.extend` keeps the schema's strictness.
function bodyValidator(
  input: OperationInput,
  location: IrLocation,
  context: ValidatorContext,
): string {
  if (input.media !== JSON_MEDIA) {
    const mediaLocation = below(location, "media");

    context.refusals.push(
      NOT_GENERATED_MEDIA.includes(input.media)
        ? refuseNotGeneratedYet("input.media", `A '${input.media}' body`, mediaLocation)
        : refuseUnknownValueAt(mediaLocation, input.media),
    );

    return REFUSED_VALIDATOR;
  }

  const schemaValidator = validatorExpression(input.schema, below(location, "schema"), context);

  if (input.proofs === undefined || input.proofs.length === 0) return schemaValidator;

  if (input.schema.kind !== "ref") {
    context.refusals.push(
      refuseNotGeneratedYet(
        "input.proofs",
        "Proof fields beside a body that is not an object schema",
        below(location, "proofs"),
      ),
    );

    return REFUSED_VALIDATOR;
  }

  const proofMembers = input.proofs.map((proof, index) => {
    const validator = validatorExpression(
      proof.schema,
      below(location, "proofs", index, "schema"),
      context,
    );

    return `${propertyKey(proof.name)}: ${validator},`;
  });

  return `${schemaValidator}.extend({\n${proofMembers.join("\n")}\n})`;
}
