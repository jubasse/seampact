import type { IrWriter } from "@seampact/spec/ir";
import type { PassReadonly, TreeSchemaService } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";

// Whether every value a role datum may hold fits a param's type use (docs/ir/07: the rendered params validate against
// the code's params schema). The fit fails closed: a JSON type the use does not take is refused, and so is a use
// carrying an enum, a format, a refinement, a union or another object schema unless the datum's own use provably
// keeps within it (the same schema or enum, an enum subset, the same format, refinements at least as narrow).

export type DeriveErrorsSchemas = PassReadonly<Record<IrWriter.SchemaId, IrWriter.Schema>>;

export type DeriveErrorsUse = PassReadonly<IrWriter.TypeUse>;

/** What the fit reads: the draft's schemas and the example validator of tree.schemas. */
export interface DeriveErrorsFit {
  readonly schemas: DeriveErrorsSchemas;
  readonly examples: Pick<TreeSchemaService, "checkExample">;
}

/** A use with whether JSON null is a value of it (a property holds its nullability beside its use). */
export interface DeriveErrorsTyped {
  readonly use: DeriveErrorsUse;
  readonly nullable: boolean;
}

/** A JSON type a rendered value may have. */
export type DeriveErrorsJsonKind =
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

export const DERIVE_ERRORS_ANY_KIND = "any";

export type DeriveErrorsKinds = ReadonlySet<DeriveErrorsJsonKind> | typeof DERIVE_ERRORS_ANY_KIND;

type Use = DeriveErrorsUse;

type Schemas = DeriveErrorsSchemas;

/** The schema a ref names; tree.schemas writes every schema a use names, so a missing one is an internal error. */
export function deriveErrorsSchemaOf(
  schemas: Schemas,
  id: IrWriter.SchemaId,
): PassReadonly<IrWriter.Schema> {
  const schema = Object.hasOwn(schemas, id) ? schemas[id] : undefined;

  if (schema === undefined)
    throw new Error(`the draft holds no schema ${id}, which a type use names`);

  return schema;
}

/** A member of an object schema as the fit reads it. */
export interface DeriveErrorsMember {
  readonly name: string;
  readonly type: Use;
  readonly optional: boolean;
  readonly nullable: boolean;
}

/** An object schema as the fit reads it: its id and members. */
export interface DeriveErrorsObject {
  readonly id: IrWriter.SchemaId;
  readonly properties: readonly DeriveErrorsMember[];
}

/** The object schema a use names, if it names one. */
export function deriveErrorsObjectOfUse(
  schemas: Schemas,
  use: Use,
): DeriveErrorsObject | undefined {
  if (use.kind !== "ref") return undefined;

  const schema = deriveErrorsSchemaOf(schemas, use.schema);

  return schema.kind === "object" ? schema : undefined;
}

/**
 * Why a rendered value may not fit a param: `omittable` when the value may be left out where the param requires it
 * (the reporter files it as a missing required value), `misfit` for any other value outside the param's type.
 */
export interface DeriveErrorsMisfitReason {
  readonly kind: "misfit" | "omittable";
  readonly text: string;
}

const OMITTABLE_REASON: DeriveErrorsMisfitReason = {
  kind: "omittable",
  text: "it may be left out, but the param requires it",
};

/** A reason of kind `misfit`. */
export const deriveErrorsMisfitReason = (text: string): DeriveErrorsMisfitReason => ({
  kind: "misfit",
  text,
});

const misfitOrNone = (text: string | undefined): DeriveErrorsMisfitReason | undefined =>
  text === undefined ? undefined : deriveErrorsMisfitReason(text);

// A reason about a part of the value (a member, an item) keeps that part's kind.
const nestedReason = (
  prefix: string,
  reason: DeriveErrorsMisfitReason,
): DeriveErrorsMisfitReason => ({ kind: reason.kind, text: `${prefix}${reason.text}` });

export function deriveErrorsKindsOf(typed: DeriveErrorsTyped): DeriveErrorsKinds {
  const { use } = typed;
  const useNullable = "nullable" in use && use.nullable === true;
  const kinds = new Set<DeriveErrorsJsonKind>(typed.nullable || useNullable ? ["null"] : []);

  switch (use.kind) {
    case "opaque":
      return DERIVE_ERRORS_ANY_KIND;
    case "file":
      return kinds;
    case "enum":
      return kinds.add("string");
    case "array":
      return kinds.add("array");
    case "scalar":
      if (use.type === "number") kinds.add("integer");

      return kinds.add(use.type);
    case "ref":
      // A union's variants are object schemas, so a union use takes an object, never an array or a scalar.
      return kinds.add("object");
  }
}

export const deriveErrorsKindsFit = (
  rendered: DeriveErrorsKinds,
  accepted: DeriveErrorsKinds,
): boolean =>
  accepted === DERIVE_ERRORS_ANY_KIND ||
  (rendered !== DERIVE_ERRORS_ANY_KIND && [...rendered].every((kind) => accepted.has(kind)));

export const deriveErrorsDescribeKinds = (kinds: DeriveErrorsKinds): string =>
  kinds === DERIVE_ERRORS_ANY_KIND ? "any JSON value" : [...kinds].sort().join(" or ");

/** Why a value of `rendered` may not validate against `accepted`, or undefined when every such value does. */
export const deriveErrorsMisfit = (
  fit: DeriveErrorsFit,
  rendered: DeriveErrorsTyped,
  accepted: DeriveErrorsTyped,
): DeriveErrorsMisfitReason | undefined => typedMisfit(fit, rendered, accepted, new Set());

// `seen` holds the pairs of object schemas under comparison, so a recursive schema ends.
function typedMisfit(
  fit: DeriveErrorsFit,
  rendered: DeriveErrorsTyped,
  accepted: DeriveErrorsTyped,
  seen: Set<string>,
): DeriveErrorsMisfitReason | undefined {
  const renderedKinds = deriveErrorsKindsOf(rendered);
  const acceptedKinds = deriveErrorsKindsOf(accepted);

  if (!deriveErrorsKindsFit(renderedKinds, acceptedKinds))
    return deriveErrorsMisfitReason(
      `the param's type (${deriveErrorsDescribeKinds(acceptedKinds)}) does not take ${deriveErrorsDescribeKinds(renderedKinds)}`,
    );

  return constraintMisfit(fit, rendered.use, accepted.use, seen);
}

// The kinds fit; what the accepted use narrows beyond them.
function constraintMisfit(
  fit: DeriveErrorsFit,
  rendered: Use,
  accepted: Use,
  seen: Set<string>,
): DeriveErrorsMisfitReason | undefined {
  switch (accepted.kind) {
    case "opaque":
    case "file":
      return undefined;
    case "enum":
      return misfitOrNone(enumMisfit(rendered, accepted));
    case "scalar":
      return misfitOrNone(
        rendered.kind === "scalar"
          ? scalarMisfit(fit, rendered, accepted)
          : `its values are not provably within the param's ${describeScalar(accepted)}`,
      );
    case "array":
      return rendered.kind === "array" ? arrayMisfit(fit, rendered, accepted, seen) : undefined;
    case "ref":
      return refMisfit(fit, rendered, accepted, seen);
  }
}

function enumMisfit(
  rendered: Use,
  accepted: PassReadonly<IrWriter.EnumTypeUse>,
): string | undefined {
  const reason = `its values are not provably values of the enum ${quote(accepted.enum)}`;

  if (rendered.kind !== "enum" || rendered.enum !== accepted.enum) return reason;

  if (accepted.narrowedTo === undefined) return undefined;

  const allowed = new Set(accepted.narrowedTo.values);
  const values = rendered.narrowedTo?.values;

  return values?.every((value) => allowed.has(value)) === true ? undefined : reason;
}

const describeScalar = (use: PassReadonly<IrWriter.ScalarTypeUse>): string =>
  use.format === undefined ? "refinements" : `format ${quote(use.format)} and refinements`;

function scalarMisfit(
  fit: DeriveErrorsFit,
  rendered: PassReadonly<IrWriter.ScalarTypeUse>,
  accepted: PassReadonly<IrWriter.ScalarTypeUse>,
): string | undefined {
  if (accepted.format !== undefined && rendered.format !== accepted.format)
    return `its format is not the param's format ${quote(accepted.format)}`;

  if (
    accepted.content !== undefined &&
    JSON.stringify(rendered.content) !== JSON.stringify(accepted.content)
  )
    return "its JSON content is not the param's";

  return refinementsMisfit(fit, rendered.refinements, accepted.refinements);
}

type Bound = "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum";

// For each bound of the param, the datum bounds that keep within it, each checked as `{ <key>: <param bound> }`.
const BOUND_KEEPERS: readonly (readonly [Bound, readonly (readonly [Bound, Bound])[]])[] = [
  [
    "minimum",
    [
      ["minimum", "minimum"],
      ["exclusiveMinimum", "minimum"],
    ],
  ],
  [
    "exclusiveMinimum",
    [
      ["exclusiveMinimum", "minimum"],
      ["minimum", "exclusiveMinimum"],
    ],
  ],
  [
    "maximum",
    [
      ["maximum", "maximum"],
      ["exclusiveMaximum", "maximum"],
    ],
  ],
  [
    "exclusiveMaximum",
    [
      ["exclusiveMaximum", "maximum"],
      ["maximum", "exclusiveMaximum"],
    ],
  ],
];

// A decimal text checked by the example validator against one refinement: exact, whatever the bound's size.
function decimalKeeps(
  fit: DeriveErrorsFit,
  value: string,
  refinements: IrWriter.Refinements,
): boolean {
  const decimalUse: IrWriter.ScalarTypeUse = {
    kind: "scalar",
    type: "string",
    format: "decimal",
    refinements,
  };

  return fit.examples.checkExample(value, decimalUse).length === 0;
}

function refinementsMisfit(
  fit: DeriveErrorsFit,
  rendered: PassReadonly<IrWriter.Refinements>,
  accepted: PassReadonly<IrWriter.Refinements>,
): string | undefined {
  const narrower = (key: Exclude<keyof IrWriter.Refinements, "pattern">): string =>
    `its ${key} is not provably within the param's ${key} ${String(accepted[key])}`;

  if (
    accepted.minLength !== undefined &&
    (rendered.minLength === undefined || rendered.minLength < accepted.minLength)
  )
    return narrower("minLength");

  if (
    accepted.maxLength !== undefined &&
    (rendered.maxLength === undefined || rendered.maxLength > accepted.maxLength)
  )
    return narrower("maxLength");

  if (
    accepted.pattern !== undefined &&
    rendered.pattern?.normalized !== accepted.pattern.normalized
  )
    return `its pattern is not the param's pattern ${quote(accepted.pattern.source)}`;

  for (const [bound, keepers] of BOUND_KEEPERS) {
    const limit = accepted[bound];

    if (limit === undefined) continue;

    const kept = keepers.some(([own, checkedAs]) => {
      const value = rendered[own];

      return value !== undefined && decimalKeeps(fit, value, { [checkedAs]: limit });
    });

    if (!kept) return narrower(bound);
  }

  const step = accepted.multipleOf;

  if (
    step !== undefined &&
    (rendered.multipleOf === undefined ||
      !decimalKeeps(fit, rendered.multipleOf, { multipleOf: step }))
  )
    return narrower("multipleOf");

  return undefined;
}

function arrayMisfit(
  fit: DeriveErrorsFit,
  rendered: PassReadonly<IrWriter.ArrayTypeUse>,
  accepted: PassReadonly<IrWriter.ArrayTypeUse>,
  seen: Set<string>,
): DeriveErrorsMisfitReason | undefined {
  if (
    accepted.minItems !== undefined &&
    (rendered.minItems === undefined || rendered.minItems < accepted.minItems)
  )
    return deriveErrorsMisfitReason(
      `its minItems is not provably within the param's minItems ${accepted.minItems}`,
    );

  if (
    accepted.maxItems !== undefined &&
    (rendered.maxItems === undefined || rendered.maxItems > accepted.maxItems)
  )
    return deriveErrorsMisfitReason(
      `its maxItems is not provably within the param's maxItems ${accepted.maxItems}`,
    );

  const items = typedMisfit(
    fit,
    { use: rendered.items, nullable: false },
    { use: accepted.items, nullable: false },
    seen,
  );

  return items === undefined ? undefined : nestedReason("for an item, ", items);
}

function refMisfit(
  fit: DeriveErrorsFit,
  rendered: Use,
  accepted: PassReadonly<IrWriter.RefTypeUse>,
  seen: Set<string>,
): DeriveErrorsMisfitReason | undefined {
  if (rendered.kind === "ref" && rendered.schema === accepted.schema) return undefined;

  const target = deriveErrorsObjectOfUse(fit.schemas, accepted);
  const source = deriveErrorsObjectOfUse(fit.schemas, rendered);

  if (target === undefined || source === undefined)
    return deriveErrorsMisfitReason(
      `it is not provably of the param's schema ${quote(accepted.schema)}`,
    );

  // A pair of schemas already under comparison fits unless another member says otherwise.
  const pair = `${source.id} ${target.id}`;

  if (seen.has(pair)) return undefined;

  seen.add(pair);

  const member = deriveErrorsMemberMisfits(fit, source, target, new Set(), seen)[0];

  if (member !== undefined)
    return nestedReason(`for its member ${quote(member.member)}, `, member.reason);

  const unwritten = target.properties.find(
    (property) =>
      !property.optional &&
      !source.properties.some((candidate) => candidate.name === property.name),
  );

  return unwritten === undefined
    ? undefined
    : deriveErrorsMisfitReason(
        `it has no member ${quote(unwritten.name)}, which the param requires`,
      );
}

/** A member of a rendered object that may not validate against the param's object schema. */
export interface DeriveErrorsMemberMisfit {
  readonly member: string;
  /** Set when the param's schema has no such member. */
  readonly lacking: boolean;
  readonly reason: DeriveErrorsMisfitReason;
}

/**
 * The members of `source`, but `skipped` (written beside a merge), that may not validate against `target`: one the
 * target lacks, or one whose use does not fit.
 */
export function deriveErrorsMemberMisfits(
  fit: DeriveErrorsFit,
  source: DeriveErrorsObject,
  target: DeriveErrorsObject,
  skipped: ReadonlySet<string>,
  seen: Set<string> = new Set(),
): DeriveErrorsMemberMisfit[] {
  const misfits: DeriveErrorsMemberMisfit[] = [];

  for (const property of source.properties) {
    if (skipped.has(property.name)) continue;

    const accepted = target.properties.find((candidate) => candidate.name === property.name);

    if (accepted === undefined) {
      misfits.push({
        member: property.name,
        lacking: true,
        reason: deriveErrorsMisfitReason(`${quote(target.id)} has no such member`),
      });
      continue;
    }

    const reason = memberMisfit(fit, property, accepted, seen);

    if (reason !== undefined) misfits.push({ member: property.name, lacking: false, reason });
  }

  return misfits;
}

function memberMisfit(
  fit: DeriveErrorsFit,
  property: DeriveErrorsMember,
  accepted: DeriveErrorsMember,
  seen: Set<string>,
): DeriveErrorsMisfitReason | undefined {
  if (property.optional && !accepted.optional) return OMITTABLE_REASON;

  return typedMisfit(
    fit,
    { use: property.type, nullable: property.nullable },
    { use: accepted.type, nullable: accepted.nullable },
    seen,
  );
}
