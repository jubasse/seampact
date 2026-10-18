import {
  below,
  type IrLocation,
  type Refusal,
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
  requireName,
  type SchemaDirection,
} from "@seampact/codegen-core";
import {
  type ContractIR,
  type EnumTypeUse,
  isKnownVariant,
  type RefTypeUse,
  type ScalarTypeUse,
  type TypeUse,
} from "@seampact/spec/ir";
import type { ValidatorsLayout } from "./layout.js";
import { CODE_POINT_LENGTH, IS_DATE_TIME, type WireCheck } from "./module-source.js";

// What a module needs to write a validator: the IR, the planned names, where refusals go, the direction its
// schema references resolve in, and how it refers to a schema validator and to a generated check.
export interface ValidatorContext {
  ir: ContractIR;
  layout: ValidatorsLayout;
  refusals: Refusal[];
  direction: SchemaDirection;
  referToSchema(schemaId: string, exportName: string): string;
  wireCheck(check: WireCheck): string;
}

// Stands in for a refused form; the target writes no file once any form is refused.
export const REFUSED_VALIDATOR = "z.never()";

// The `8-4-4-4-12` hex layout of ADR 0003 section 8, in either case; zod's `uuid()` also checks the RFC 9562
// version and variant digits, which the contract does not.
const UUID_VALIDATOR =
  'z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { error: "Expected a UUID: 8-4-4-4-12 hex digits." })';

const BASE_VALIDATORS: ReadonlyMap<string, string> = new Map([
  ["string", "z.string()"],
  ["integer", "z.int()"],
  ["number", "z.number()"],
  ["boolean", "z.boolean()"],
]);

const NUMERIC_TYPES: readonly string[] = ["integer", "number"];

// The validator of a property, item, body or parameter. No value is coerced: query and header values arrive
// decoded.
export function validatorExpression(
  typeUse: TypeUse,
  location: IrLocation,
  context: ValidatorContext,
): string {
  if (!isKnownVariant("TypeUse", typeUse)) {
    context.refusals.push(refuseUnknownValueAt(below(location, "kind"), typeUse.kind));

    return REFUSED_VALIDATOR;
  }

  if (typeUse.kind !== "opaque" && typeUse.nullable === true) {
    context.refusals.push(
      refuseNotGeneratedYet("type.nullable", "A nullable type", below(location, "nullable")),
    );
  }

  switch (typeUse.kind) {
    case "ref":
      return refValidator(typeUse, location, context);
    case "opaque":
      return "z.unknown()";
    case "file":
      context.refusals.push(refuseNotGeneratedYet("type.file", "A file type", location));

      return REFUSED_VALIDATOR;
    case "enum":
      return enumValidator(typeUse, location, context);
    case "scalar":
      return scalarValidator(typeUse, location, context);
    case "array": {
      const items = validatorExpression(typeUse.items, below(location, "items"), context);
      const minimum = typeUse.minItems === undefined ? "" : `.min(${typeUse.minItems})`;
      const maximum = typeUse.maxItems === undefined ? "" : `.max(${typeUse.maxItems})`;

      return `z.array(${items})${minimum}${maximum}`;
    }
  }
}

// The validator of a schema in the context's direction, after the checks every reference to a schema takes.
export function schemaValidatorReference(
  schemaId: string,
  location: IrLocation,
  context: ValidatorContext,
): string {
  if (!Object.hasOwn(context.ir.schemas, schemaId)) {
    context.refusals.push(
      refuseInconsistentIr(
        "schema.ref.unresolved",
        `The schema '${schemaId}' is not declared`,
        location,
      ),
    );

    return REFUSED_VALIDATOR;
  }

  if (!requireName(context.layout.schemaDirections, schemaId).includes(context.direction)) {
    context.refusals.push(
      refuseInconsistentIr(
        "schema.direction.missing",
        `The schema '${schemaId}' is used in the ${context.direction} direction, which its \`directions\` do not list`,
        location,
      ),
    );

    return REFUSED_VALIDATOR;
  }

  return context.referToSchema(schemaId, requireName(context.layout.schemaExportNames, schemaId));
}

function refValidator(
  typeUse: RefTypeUse,
  location: IrLocation,
  context: ValidatorContext,
): string {
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

  return schemaValidatorReference(typeUse.schema, below(location, "schema"), context);
}

function enumValidator(
  typeUse: EnumTypeUse,
  location: IrLocation,
  context: ValidatorContext,
): string {
  if (typeUse.narrowedTo !== undefined) {
    context.refusals.push(
      refuseNotGeneratedYet("enum.narrowedTo", "A narrowed enum", below(location, "narrowedTo")),
    );
  }

  const declaration = Object.hasOwn(context.ir.enums, typeUse.enum)
    ? context.ir.enums[typeUse.enum]
    : undefined;

  if (declaration === undefined) {
    context.refusals.push(
      refuseInconsistentIr(
        "enum.ref.unresolved",
        `The enum '${typeUse.enum}' is not declared`,
        below(location, "enum"),
      ),
    );

    return REFUSED_VALIDATOR;
  }

  if (declaration.values.length === 0) return "z.never()";

  return `z.enum(${JSON.stringify(declaration.values)})`;
}

function scalarValidator(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  context: ValidatorContext,
): string {
  refuseScalarForms(typeUse, location, context);

  const base = baseValidator(typeUse, location, context);
  const checks = [
    ...lengthChecks(typeUse, location, context),
    ...boundChecks(typeUse, location, context),
  ];

  return `${base}${checks.join("")}`;
}

function refuseScalarForms(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  context: ValidatorContext,
): void {
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

  const refinements = typeUse.refinements;
  const refinementsLocation = below(location, "refinements");
  const notGenerated = [
    ["pattern", refinements.pattern],
    ["exclusiveMinimum", refinements.exclusiveMinimum],
    ["exclusiveMaximum", refinements.exclusiveMaximum],
    ["multipleOf", refinements.multipleOf],
  ] as const;

  for (const [refinement, value] of notGenerated) {
    if (value === undefined) continue;

    context.refusals.push(
      refuseNotGeneratedYet(
        `scalar.${refinement}`,
        `The refinement '${refinement}'`,
        below(refinementsLocation, refinement),
      ),
    );
  }
}

function baseValidator(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  context: ValidatorContext,
): string {
  if (typeUse.format !== undefined) {
    const formatValidator =
      typeUse.type === "string" ? stringFormatValidator(typeUse.format, context) : undefined;

    if (formatValidator !== undefined) return formatValidator;

    context.refusals.push(
      refuseNotGeneratedYet(
        "scalar.format",
        `The format '${typeUse.format}' of a ${typeUse.type}`,
        below(location, "format"),
      ),
    );

    return REFUSED_VALIDATOR;
  }

  const validator = BASE_VALIDATORS.get(typeUse.type);

  if (validator !== undefined) return validator;

  context.refusals.push(refuseUnknownValueAt(below(location, "type"), typeUse.type));

  return REFUSED_VALIDATOR;
}

function stringFormatValidator(format: string, context: ValidatorContext): string | undefined {
  if (format === "uuid") return UUID_VALIDATOR;

  // RFC 3339 with a time offset; a value without one is refused.
  if (format === "date-time") {
    return `z.string().refine(${context.wireCheck(IS_DATE_TIME)}, { error: "Expected an RFC 3339 date-time with a time offset.", params: { rule: "format" } })`;
  }

  return undefined;
}

// String lengths count Unicode code points (ADR 0003 section 1); zod's own `min` and `max` count UTF-16 units. A
// custom check carries its contract rule name in `params.rule`, which a server boundary renders.
function lengthChecks(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  context: ValidatorContext,
): string[] {
  const { minLength, maxLength } = typeUse.refinements;

  if (minLength === undefined && maxLength === undefined) return [];

  if (typeUse.type !== "string") {
    context.refusals.push(
      refuseInconsistentIr(
        "scalar.length.misplaced",
        `A length bound on a ${typeUse.type}`,
        below(location, "refinements"),
      ),
    );

    return [];
  }

  const counter = context.wireCheck(CODE_POINT_LENGTH);
  const checks: string[] = [];

  if (minLength !== undefined) {
    checks.push(
      `.refine((value) => ${counter}(value) >= ${minLength}, { error: ${JSON.stringify(`Expected at least ${characters(minLength)}.`)}, params: { rule: "minLength" } })`,
    );
  }

  if (maxLength !== undefined) {
    checks.push(
      `.refine((value) => ${counter}(value) <= ${maxLength}, { error: ${JSON.stringify(`Expected at most ${characters(maxLength)}.`)}, params: { rule: "maxLength" } })`,
    );
  }

  return checks;
}

function characters(count: number): string {
  return count === 1 ? "1 character" : `${count} characters`;
}

function boundChecks(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  context: ValidatorContext,
): string[] {
  const { minimum, maximum } = typeUse.refinements;
  const refinementsLocation = below(location, "refinements");

  if (minimum === undefined && maximum === undefined) return [];

  if (!NUMERIC_TYPES.includes(typeUse.type)) {
    context.refusals.push(
      refuseInconsistentIr(
        "scalar.bound.misplaced",
        `A numeric bound on a ${typeUse.type}`,
        refinementsLocation,
      ),
    );

    return [];
  }

  const bounds = [
    ["minimum", "gte", minimum],
    ["maximum", "lte", maximum],
  ] as const;

  return bounds.flatMap(([refinement, method, literal]) => {
    if (literal === undefined) return [];

    const exact = exactNumberLiteral(literal);

    if (exact === undefined) {
      context.refusals.push(
        refuseNotGeneratedYet(
          "scalar.bound.inexact",
          `The bound '${literal}', which a JavaScript number does not hold exactly,`,
          below(refinementsLocation, refinement),
        ),
      );

      return [];
    }

    return [`.${method}(${exact})`];
  });
}

// The decimal literal as JavaScript source when it reads back unchanged from the nearest double, as a JSON
// decoder would read it (`0.1` does), else undefined.
function exactNumberLiteral(literal: string): string | undefined {
  const value = Number(literal);

  if (!Number.isFinite(value) || String(value) !== literal) return undefined;

  return literal;
}
