import {
  type ContractIR,
  type EnumTypeUse,
  isKnownVariant,
  type RefTypeUse,
  type ScalarTypeUse,
  type TypeUse,
} from "@seampact/spec/ir";
import type { SchemaDirection } from "../descriptors.js";
import { below, type IrLocation } from "../ir-location.js";
import {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "../located-refusals.js";
import { requireName } from "../planned-names.js";
import type { Refusal } from "../refusal.js";
import type { ValidatorsLayout } from "./layout.js";

// What every validator library checks for one type use, whatever its syntax: the kind, each check under its
// contract rule name with the message it reports, and a refused form as `refused` once its refusal is recorded.
// A plan with a refusal is never rendered.
export type TypePlan =
  | { readonly kind: "refused" }
  // An opaque value: any JSON value, `null` only when nullable (ADR 0003 section 2).
  | { readonly kind: "unknown"; readonly nullable: boolean }
  | { readonly kind: "schema"; readonly schemaId: string; readonly exportName: string }
  // An output enum keeps an unknown member (ADR 0003 section 4): `openMembers` makes the validators accept any string.
  | { readonly kind: "enum"; readonly values: readonly string[]; readonly openMembers: boolean }
  | {
      readonly kind: "array";
      readonly items: TypePlan;
      readonly minItems: number | undefined;
      readonly maxItems: number | undefined;
    }
  | ScalarPlan;

export type ScalarBase = "string" | "integer" | "number" | "boolean";

export interface ScalarPlan {
  readonly kind: "scalar";
  readonly base: ScalarBase;
  readonly checks: readonly ScalarCheck[];
}

// The numeric refinements of an integer or a number, each the exact decimal literal of the contract.
const NUMERIC_RULES = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;

export type NumericRule = (typeof NUMERIC_RULES)[number];

export type StringFormat = "uuid" | "date-time";

// A string length counts Unicode code points (ADR 0003 section 1); a bound is the exact decimal literal of the
// contract, which a JavaScript number reads back unchanged.
export type ScalarCheck =
  | { readonly rule: "format"; readonly format: StringFormat; readonly message: string }
  | { readonly rule: "minLength" | "maxLength"; readonly limit: number; readonly message: string }
  | { readonly rule: "pattern"; readonly normalized: string; readonly message: string }
  | { readonly rule: NumericRule; readonly literal: string };

// One member of an object, parameter set or proof list: its key as written on the wire, its type and whether
// it may be absent.
export interface FieldPlan {
  readonly key: string;
  readonly type: TypePlan;
  readonly optional: boolean;
}

// `refuse` reports an unknown key as an issue; `strip` drops it.
export type UnknownKeys = "refuse" | "strip";

export interface ObjectPlan {
  readonly unknownKeys: UnknownKeys;
  readonly fields: readonly FieldPlan[];
}

// What a plan walk needs: the IR, the planned names, where refusals go, and the direction its schema references
// resolve in.
export interface PlanContext {
  readonly ir: ContractIR;
  readonly layout: ValidatorsLayout;
  readonly refusals: Refusal[];
  readonly direction: SchemaDirection;
}

const REFUSED: TypePlan = { kind: "refused" };

const SCALAR_BASES: readonly ScalarBase[] = ["string", "integer", "number", "boolean"];

const NUMERIC_TYPES: readonly string[] = ["integer", "number"];

const FORMAT_MESSAGES: Readonly<Record<StringFormat, string>> = {
  uuid: "Expected a UUID: 8-4-4-4-12 hex digits.",
  // RFC 3339 with a time offset; a value without one is refused.
  "date-time": "Expected an RFC 3339 date-time with a time offset.",
};

// The plan of a property, item, body or parameter. No value is coerced: query and header values arrive decoded.
export function planTypeUse(
  typeUse: TypeUse,
  location: IrLocation,
  context: PlanContext,
): TypePlan {
  if (!isKnownVariant("TypeUse", typeUse)) {
    context.refusals.push(refuseUnknownValueAt(below(location, "kind"), typeUse.kind));

    return REFUSED;
  }

  if (typeUse.kind !== "opaque" && typeUse.nullable === true) {
    context.refusals.push(
      refuseNotGeneratedYet("type.nullable", "A nullable type", below(location, "nullable")),
    );
  }

  switch (typeUse.kind) {
    case "ref":
      return refPlan(typeUse, location, context);
    case "opaque":
      return { kind: "unknown", nullable: typeUse.nullable === true };
    case "file":
      context.refusals.push(refuseNotGeneratedYet("type.file", "A file type", location));

      return REFUSED;
    case "enum":
      return enumPlan(typeUse, location, context);
    case "scalar":
      return scalarPlan(typeUse, location, context);
    case "array":
      return {
        kind: "array",
        items: planTypeUse(typeUse.items, below(location, "items"), context),
        minItems: typeUse.minItems,
        maxItems: typeUse.maxItems,
      };
  }
}

// The schemas a plan references, in walk order, so a module declares each after them.
export function referencedSchemas(plan: TypePlan): string[] {
  if (plan.kind === "schema") return [plan.schemaId];

  if (plan.kind === "array") return referencedSchemas(plan.items);

  return [];
}

// A schema reference in the context's direction, after the checks every reference to a schema takes.
function schemaReferencePlan(
  schemaId: string,
  location: IrLocation,
  context: PlanContext,
): TypePlan {
  if (!Object.hasOwn(context.ir.schemas, schemaId)) {
    context.refusals.push(
      refuseInconsistentIr(
        "schema.ref.unresolved",
        `The schema '${schemaId}' is not declared`,
        location,
      ),
    );

    return REFUSED;
  }

  if (!requireName(context.layout.schemaDirections, schemaId).includes(context.direction)) {
    context.refusals.push(
      refuseInconsistentIr(
        "schema.direction.missing",
        `The schema '${schemaId}' is used in the ${context.direction} direction, which its \`directions\` do not list`,
        location,
      ),
    );

    return REFUSED;
  }

  return {
    kind: "schema",
    schemaId,
    exportName: requireName(context.layout.schemaExportNames, schemaId),
  };
}

function refPlan(typeUse: RefTypeUse, location: IrLocation, context: PlanContext): TypePlan {
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

  return schemaReferencePlan(typeUse.schema, below(location, "schema"), context);
}

function enumPlan(typeUse: EnumTypeUse, location: IrLocation, context: PlanContext): TypePlan {
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

    return REFUSED;
  }

  return {
    kind: "enum",
    values: [...declaration.values],
    openMembers: context.direction === "output",
  };
}

function scalarPlan(typeUse: ScalarTypeUse, location: IrLocation, context: PlanContext): TypePlan {
  refuseScalarForms(typeUse, location, context.refusals);

  const base = scalarBase(typeUse, location, context.refusals);
  const checks = [
    ...lengthChecks(typeUse, location, context.refusals),
    ...patternChecks(typeUse, location, context.refusals),
    ...boundChecks(typeUse, location, context.refusals),
  ];

  if (base === undefined) return REFUSED;

  return { kind: "scalar", base: base.base, checks: [...base.formatChecks, ...checks] };
}

function refuseScalarForms(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  refusals: Refusal[],
): void {
  if (typeUse.scalar !== undefined) {
    refusals.push(
      refuseNotGeneratedYet(
        "scalar.named",
        `The named format '${typeUse.scalar}'`,
        below(location, "scalar"),
      ),
    );
  }

  if (typeUse.content !== undefined) {
    refusals.push(
      refuseNotGeneratedYet("scalar.content", "A JSON text field", below(location, "content")),
    );
  }
}

// The base type, with its format check first, or undefined once refused.
function scalarBase(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  refusals: Refusal[],
): { base: ScalarBase; formatChecks: readonly ScalarCheck[] } | undefined {
  if (typeUse.format !== undefined) {
    const format = typeUse.type === "string" ? stringFormat(typeUse.format) : undefined;

    if (format !== undefined) {
      return {
        base: "string",
        formatChecks: [{ rule: "format", format, message: FORMAT_MESSAGES[format] }],
      };
    }

    refusals.push(
      refuseNotGeneratedYet(
        "scalar.format",
        `The format '${typeUse.format}' of a ${typeUse.type}`,
        below(location, "format"),
      ),
    );

    return undefined;
  }

  const base = SCALAR_BASES.find((known) => known === typeUse.type);

  if (base !== undefined) return { base, formatChecks: [] };

  refusals.push(refuseUnknownValueAt(below(location, "type"), typeUse.type));

  return undefined;
}

function stringFormat(format: string): StringFormat | undefined {
  return format === "uuid" || format === "date-time" ? format : undefined;
}

function lengthChecks(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  refusals: Refusal[],
): ScalarCheck[] {
  const { minLength, maxLength } = typeUse.refinements;

  if (minLength === undefined && maxLength === undefined) return [];

  if (typeUse.type !== "string") {
    refusals.push(
      refuseInconsistentIr(
        "scalar.length.misplaced",
        `A length bound on a ${typeUse.type}`,
        below(location, "refinements"),
      ),
    );

    return [];
  }

  const checks: ScalarCheck[] = [];

  if (minLength !== undefined) {
    checks.push({
      rule: "minLength",
      limit: minLength,
      message: `Expected at least ${characters(minLength)}.`,
    });
  }

  if (maxLength !== undefined) {
    checks.push({
      rule: "maxLength",
      limit: maxLength,
      message: `Expected at most ${characters(maxLength)}.`,
    });
  }

  return checks;
}

// The normalised pattern is ECMAScript `u` syntax with no engine-dependent construct left (ADR 0003 section 9).
function patternChecks(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  refusals: Refusal[],
): ScalarCheck[] {
  const { pattern } = typeUse.refinements;

  if (pattern === undefined) return [];

  if (typeUse.type !== "string") {
    refusals.push(
      refuseInconsistentIr(
        "scalar.pattern.misplaced",
        `A pattern on a ${typeUse.type}`,
        below(location, "refinements", "pattern"),
      ),
    );

    return [];
  }

  return [
    {
      rule: "pattern",
      normalized: pattern.normalized,
      message: `Expected a value matching ${pattern.source}.`,
    },
  ];
}

function characters(count: number): string {
  return count === 1 ? "1 character" : `${count} characters`;
}

function boundChecks(
  typeUse: ScalarTypeUse,
  location: IrLocation,
  refusals: Refusal[],
): ScalarCheck[] {
  const refinements = typeUse.refinements;
  const refinementsLocation = below(location, "refinements");
  const written = NUMERIC_RULES.flatMap((rule) => {
    const literal = refinements[rule];

    return literal === undefined ? [] : [{ rule, literal }];
  });

  if (written.length === 0) return [];

  if (!NUMERIC_TYPES.includes(typeUse.type)) {
    refusals.push(
      refuseInconsistentIr(
        "scalar.bound.misplaced",
        `A numeric bound on a ${typeUse.type}`,
        refinementsLocation,
      ),
    );

    return [];
  }

  return written.flatMap(({ rule, literal }): ScalarCheck[] => {
    if (!isExactNumberLiteral(literal)) {
      refusals.push(
        refuseNotGeneratedYet(
          "scalar.bound.inexact",
          `The bound '${literal}', which a JavaScript number does not hold exactly,`,
          below(refinementsLocation, rule),
        ),
      );

      return [];
    }

    return [{ rule, literal }];
  });
}

// True when the decimal literal reads back unchanged from the nearest double, as a JSON decoder would read it
// (`0.1` does).
function isExactNumberLiteral(literal: string): boolean {
  const value = Number(literal);

  return Number.isFinite(value) && String(value) === literal;
}
