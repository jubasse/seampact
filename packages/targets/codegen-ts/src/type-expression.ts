import {
  below,
  type IrLocation,
  type Refusal,
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
  requireName,
} from "@seampact/codegen-core";
import {
  type ContractIR,
  isKnownVariant,
  type RefTypeUse,
  type ScalarTypeUse,
  type TypeUse,
} from "@seampact/spec/ir";
import type { TypesLayout } from "./layout.js";

// What a module needs to write a type use: the IR, the planned names, where refusals go, and how it refers to a
// schema or enum type (by its bare name in the schemas module, through the namespace import elsewhere).
export interface TypeContext {
  ir: ContractIR;
  layout: TypesLayout;
  refusals: Refusal[];
  referToNamedType(typeName: string): string;
}

// Stands in for a refused form; the target writes no file once any form is refused.
export const REFUSED_TYPE = "never";

const TYPE_OF_SCALAR: ReadonlyMap<string, string> = new Map([
  ["string", "string"],
  ["integer", "number"],
  ["number", "number"],
  ["boolean", "boolean"],
]);

// The string formats the TypeScript type is a plain `string` for (ADR 0003 section 8: a JavaScript `Date` keeps
// milliseconds only, so `date-time` stays a string).
const STRING_FORMATS: readonly string[] = ["uuid", "date-time"];

// The TypeScript type of a property, item, body or parameter.
export function typeExpression(
  typeUse: TypeUse,
  location: IrLocation,
  context: TypeContext,
): string {
  if (!isKnownVariant("TypeUse", typeUse)) {
    context.refusals.push(refuseUnknownValueAt(below(location, "kind"), typeUse.kind));

    return REFUSED_TYPE;
  }

  if (typeUse.kind !== "opaque" && typeUse.nullable === true) {
    context.refusals.push(
      refuseNotGeneratedYet("type.nullable", "A nullable type", below(location, "nullable")),
    );
  }

  switch (typeUse.kind) {
    case "ref":
      return refExpression(typeUse, location, context);
    case "opaque":
      return "unknown";
    case "file":
      context.refusals.push(refuseNotGeneratedYet("type.file", "A file type", location));

      return REFUSED_TYPE;
    case "enum":
      return enumExpression(typeUse.enum, typeUse.narrowedTo !== undefined, location, context);
    case "scalar":
      return scalarExpression(typeUse, location, context);
    case "array":
      return `${typeExpression(typeUse.items, below(location, "items"), context)}[]`;
  }
}

// The named type of a schema reference, after the checks every reference to a schema takes.
export function schemaTypeReference(
  schemaId: string,
  location: IrLocation,
  context: TypeContext,
): string {
  if (!Object.hasOwn(context.ir.schemas, schemaId)) {
    context.refusals.push(
      refuseInconsistentIr(
        "schema.ref.unresolved",
        `The schema '${schemaId}' is not declared`,
        location,
      ),
    );

    return REFUSED_TYPE;
  }

  return context.referToNamedType(requireName(context.layout.schemaTypeNames, schemaId));
}

function refExpression(typeUse: RefTypeUse, location: IrLocation, context: TypeContext): string {
  const policy = typeUse.unknownKeys?.policy;
  const policyLocation = below(location, "unknownKeys", "policy");

  if (policy === "ignore" || policy === "keep") {
    context.refusals.push(
      refuseNotGeneratedYet(
        `unknownKeys.${policy}`,
        `The unknown keys policy '${policy}'`,
        policyLocation,
      ),
    );
  } else if (policy !== undefined && policy !== "refuse") {
    context.refusals.push(refuseUnknownValueAt(policyLocation, policy));
  }

  return schemaTypeReference(typeUse.schema, below(location, "schema"), context);
}

function enumExpression(
  enumId: string,
  isNarrowed: boolean,
  location: IrLocation,
  context: TypeContext,
): string {
  if (isNarrowed) {
    context.refusals.push(
      refuseNotGeneratedYet("enum.narrowedTo", "A narrowed enum", below(location, "narrowedTo")),
    );
  }

  if (!Object.hasOwn(context.ir.enums, enumId)) {
    context.refusals.push(
      refuseInconsistentIr(
        "enum.ref.unresolved",
        `The enum '${enumId}' is not declared`,
        below(location, "enum"),
      ),
    );

    return REFUSED_TYPE;
  }

  return context.referToNamedType(requireName(context.layout.enumTypeNames, enumId));
}

function scalarExpression(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  context: TypeContext,
): string {
  if (typeUse.scalar !== undefined) {
    context.refusals.push(
      refuseNotGeneratedYet(
        "scalar.named",
        `The named format '${typeUse.scalar}'`,
        below(location, "scalar"),
      ),
    );
  }

  if (typeUse.content !== undefined) {
    context.refusals.push(
      refuseNotGeneratedYet("scalar.content", "A JSON text field", below(location, "content")),
    );
  }

  if (
    typeUse.format !== undefined &&
    !(typeUse.type === "string" && STRING_FORMATS.includes(typeUse.format))
  ) {
    context.refusals.push(
      refuseNotGeneratedYet(
        "scalar.format",
        `The format '${typeUse.format}' of a ${typeUse.type}`,
        below(location, "format"),
      ),
    );
  }

  const scalarType = TYPE_OF_SCALAR.get(typeUse.type);

  if (scalarType === undefined) {
    context.refusals.push(refuseUnknownValueAt(below(location, "type"), typeUse.type));

    return REFUSED_TYPE;
  }

  return scalarType;
}
