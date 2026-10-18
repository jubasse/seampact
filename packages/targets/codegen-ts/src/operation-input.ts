import type { Operation, OperationInput, Param } from "@seampact/spec/ir";
import { below, type IrLocation } from "./ir-location.js";
import { requireName } from "./layout.js";
import { propertyKey } from "./property-key.js";
import { refuseInconsistentIr, refuseNotGeneratedYet, refuseUnknownValueAt } from "./refusals.js";
import { REFUSED_TYPE, type TypeContext, typeExpression } from "./type-expression.js";

const JSON_MEDIA = "application/json";
const NOT_GENERATED_MEDIA: readonly string[] = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
];

// The whole request of an operation, `{ path, query, headers, body }`, each member present when the operation
// declares it: path and query keys are wire names, header keys the lowercased wire names Node delivers.
export function operationInputDeclaration(
  operation: Operation,
  location: IrLocation,
  context: TypeContext,
): string {
  const paramsLocation = below(location, "params");
  const members: string[] = [];

  if (operation.params.path.length > 0) {
    members.push(
      `path: ${paramsType(operation.params.path, (name) => name, below(paramsLocation, "path"), context)};`,
    );
  }

  if (operation.params.query.length > 0) {
    members.push(
      `query: ${paramsType(operation.params.query, (name) => name, below(paramsLocation, "query"), context)};`,
    );
  }

  if (operation.params.header.length > 0) {
    const headerLocation = below(paramsLocation, "header");

    refuseDuplicateHeaders(operation.params.header, headerLocation, context);
    members.push(
      `headers: ${paramsType(operation.params.header, (name) => name.toLowerCase(), headerLocation, context)};`,
    );
  }

  if (operation.input !== undefined) {
    members.push(`body: ${bodyType(operation.input, below(location, "input"), context)};`);
  }

  const typeName = requireName(context.layout.operationTypeNames, operation.id).input;

  return `export type ${typeName} = {\n${members.join("\n")}\n};`;
}

function paramsType(
  params: readonly Param[],
  keyOf: (wireName: string) => string,
  location: IrLocation,
  context: TypeContext,
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

    const type = typeExpression(param.type, below(paramLocation, "type"), context);

    return `${propertyKey(keyOf(param.name))}${param.required ? "" : "?"}: ${type};`;
  });

  return `{\n${members.join("\n")}\n}`;
}

function refuseDuplicateHeaders(
  headers: readonly Param[],
  location: IrLocation,
  context: TypeContext,
): void {
  const seen = new Set<string>();

  headers.forEach((header, index) => {
    const key = header.name.toLowerCase();

    if (seen.has(key)) {
      context.refusals.push(
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

// The JSON body: the input schema's type, followed by the body fields of rule proofs (ADR 0004 section 7).
function bodyType(input: OperationInput, location: IrLocation, context: TypeContext): string {
  if (input.media !== JSON_MEDIA) {
    const mediaLocation = below(location, "media");

    context.refusals.push(
      NOT_GENERATED_MEDIA.includes(input.media)
        ? refuseNotGeneratedYet("input.media", `A '${input.media}' body`, mediaLocation)
        : refuseUnknownValueAt(mediaLocation, input.media),
    );

    return REFUSED_TYPE;
  }

  const schemaType = typeExpression(input.schema, below(location, "schema"), context);

  if (input.proofs === undefined || input.proofs.length === 0) return schemaType;

  if (input.schema.kind !== "ref") {
    context.refusals.push(
      refuseNotGeneratedYet(
        "input.proofs",
        "Proof fields beside a body that is not an object schema",
        below(location, "proofs"),
      ),
    );

    return REFUSED_TYPE;
  }

  const proofMembers = input.proofs.map((proof, index) => {
    const type = typeExpression(proof.schema, below(location, "proofs", index, "schema"), context);

    return `${propertyKey(proof.name)}: ${type};`;
  });

  return `${schemaType} & {\n${proofMembers.join("\n")}\n}`;
}
