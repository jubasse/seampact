import type { IrWriter } from "@seampact/spec/ir";
import { splitName } from "@seampact/spec/naming";
import { treeSchemasNormalizePattern } from "./pattern.js";
import {
  type TreeSchemasRaw,
  type TreeSchemasRawObject,
  type TreeSchemasReporter,
  treeSchemasEntries,
  treeSchemasIsObject,
  treeSchemasMember,
  treeSchemasPointer,
} from "./raw.js";

// Scalars, formats and refinements (ADR 0003 sections 8 and 9): the portable formats, the named formats of the
// `scalars` catalogue, and refinements with numeric bounds as decimal literal strings (ADR 0004 section 13).

/** The portable formats of ADR 0003 section 8, each with the type it is written beside. */
const treeSchemasPortableFormats: Readonly<Record<string, IrWriter.ScalarType>> = Object.freeze({
  uuid: "string",
  "date-time": "string",
  date: "string",
  int64: "integer",
  decimal: "string",
  email: "string",
  uri: "string",
  "uri-reference": "string",
});

// What `sensitive` emits; never written as a format or a named format.
const PASSWORD = "password";
const DECIMAL = "decimal";

const LENGTHS = ["minLength", "maxLength"] as const;
const BOUNDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const;
const LOWER_BOUNDS = ["minimum", "exclusiveMinimum"] as const;
const UPPER_BOUNDS = ["maximum", "exclusiveMaximum"] as const;

// A double holds 15 to 17 significant digits: a fraction whose shortest form takes 17 was written with digits the
// loaded number may no longer hold.
const MAX_FRACTION_DIGITS = 16;

const portableTypeOf = (format: string): IrWriter.ScalarType | undefined =>
  Object.hasOwn(treeSchemasPortableFormats, format)
    ? treeSchemasPortableFormats[format]
    : undefined;

/**
 * A number as the decimal literal string of its loaded value: undefined for an integer beyond the safe range or a
 * fraction whose shortest form takes more than 16 significant digits. Only the loaded number is checked: digits the
 * loader already rounded away (`0.10000000000000001` loads as `0.1`) are not seen here.
 */
function treeSchemasDecimalLiteral(value: number): string | undefined {
  if (Number.isInteger(value)) return Number.isSafeInteger(value) ? String(value) : undefined;
  const literal = withoutExponent(String(value));

  return significantDigits(literal) > MAX_FRACTION_DIGITS ? undefined : literal;
}

// A fraction's shortest form as plain digits: JavaScript writes one below 1e-6 with an exponent (`1e-7`).
function withoutExponent(text: string): string {
  const exponent = /^(-?)([0-9])(?:\.([0-9]+))?e-([0-9]+)$/.exec(text);

  if (exponent === null) return text;
  const [, sign = "", lead = "", fraction = "", shift = "1"] = exponent;

  return `${sign}0.${"0".repeat(Number(shift) - 1)}${lead}${fraction}`;
}

const significantDigits = (literal: string): number =>
  literal.replace("-", "").replace(".", "").replace(/^0+/, "").length;

// The bounds no value fits between: a lower bound above an upper one, equal to it with either exclusive, or, for an
// integer, no integer left between them.
function emptyRanges(refinements: IrWriter.Refinements, type: IrWriter.ScalarType): string[] {
  const { minLength, maxLength } = refinements;
  const lengths =
    minLength !== undefined && maxLength !== undefined && minLength > maxLength
      ? [`'minLength' ${minLength} is above 'maxLength' ${maxLength}`]
      : [];
  const bounds = LOWER_BOUNDS.flatMap((lowerKey) =>
    UPPER_BOUNDS.flatMap((upperKey) => {
      const lower = refinements[lowerKey];
      const upper = refinements[upperKey];

      if (lower === undefined || upper === undefined) return [];
      const problem = emptyBetween(
        { key: lowerKey, literal: lower },
        { key: upperKey, literal: upper },
        type,
      );

      return problem === undefined ? [] : [problem];
    }),
  );

  return [...lengths, ...bounds];
}

interface Bound<Key extends string> {
  key: Key;
  literal: string;
}

function emptyBetween(
  lower: Bound<(typeof LOWER_BOUNDS)[number]>,
  upper: Bound<(typeof UPPER_BOUNDS)[number]>,
  type: IrWriter.ScalarType,
): string | undefined {
  const lowerText = `'${lower.key}' ${lower.literal}`;
  const upperText = `'${upper.key}' ${upper.literal}`;
  const exclusive = lower.key === "exclusiveMinimum" || upper.key === "exclusiveMaximum";

  if (Number(lower.literal) > Number(upper.literal)) return `${lowerText} is above ${upperText}`;

  if (Number(lower.literal) === Number(upper.literal) && exclusive)
    return `${lowerText} equals ${upperText}, one of them exclusive`;

  if (type === "integer" && lowestInteger(lower) > highestInteger(upper))
    return `no integer lies between ${lowerText} and ${upperText}`;

  return undefined;
}

const lowestInteger = ({ key, literal }: Bound<string>): number =>
  key === "minimum" ? Math.ceil(Number(literal)) : Math.floor(Number(literal)) + 1;

const highestInteger = ({ key, literal }: Bound<string>): number =>
  key === "maximum" ? Math.floor(Number(literal)) : Math.ceil(Number(literal)) - 1;

interface RefinementTarget {
  type: IrWriter.ScalarType;
  /** A `decimal` string, which takes the numeric refinements. */
  decimal: boolean;
}

/** The scalar uses of the api: plain scalars, portable formats and the named formats of `scalars`. */
export class TreeSchemasScalars {
  private readonly declarations = new Map<string, IrWriter.Scalar | undefined>();

  constructor(
    private readonly catalogue: TreeSchemasRaw | undefined,
    private readonly reporter: TreeSchemasReporter,
  ) {}

  /** Every named format of the `scalars` catalogue, in written order; a refused one is left out. */
  all(): IrWriter.Scalar[] {
    return treeSchemasEntries(this.catalogue).flatMap(([id]) => this.declaration(id) ?? []);
  }

  /** The scalar use of a mapping with `type`, or of a named format written without one. */
  use(value: TreeSchemasRawObject, pointer: string): IrWriter.ScalarTypeUse | undefined {
    const type = value.type;
    const format = typeof value.format === "string" ? value.format : undefined;

    if (type !== "string" && type !== "integer" && type !== "number" && type !== "boolean")
      return format === undefined ? undefined : this.namedFormatUse(format, value, pointer);

    if (format !== undefined && !this.checkFormatBesideType(format, type, pointer))
      return undefined;
    const refinements = this.refinements(value, pointer, { type, decimal: format === DECIMAL });

    if (refinements === undefined || !this.checkRanges(refinements, type, pointer))
      return undefined;

    return { kind: "scalar", type, ...(format === undefined ? {} : { format }), refinements };
  }

  private declaration(id: string): IrWriter.Scalar | undefined {
    if (this.declarations.has(id)) return this.declarations.get(id);
    const pointer = treeSchemasPointer("/scalars", id);
    const value = treeSchemasMember(this.catalogue, id);
    const scalar = treeSchemasIsObject(value)
      ? this.compileDeclaration(id, value, pointer)
      : undefined;

    this.declarations.set(id, scalar);

    return scalar;
  }

  private compileDeclaration(
    id: string,
    value: TreeSchemasRawObject,
    pointer: string,
  ): IrWriter.Scalar | undefined {
    const portable = portableTypeOf(id);

    if (portable !== undefined || id === PASSWORD) {
      this.reporter.error({
        rule: "scalar-name",
        pointer,
        message: `the named format '${id}' takes the name of ${id === PASSWORD ? "what 'sensitive' emits" : "a portable format"}, so one name would mean two checks`,
        fix:
          portable === undefined
            ? "remove it and mark the field 'sensitive: true'"
            : `remove it and write 'type: ${portable}, format: ${id}' where it is used`,
      });

      return undefined;
    }

    const type = value.type === "integer" ? "integer" : "string";
    const refinements = this.refinements(value, pointer, { type, decimal: false });

    if (refinements === undefined || !this.checkRanges(refinements, type, pointer))
      return undefined;

    return {
      id,
      name: { segments: splitName(id), role: "schema" },
      type: { kind: "scalar", type, refinements },
      directions: [],
      docs: treeSchemasDocs(value),
      origin: this.reporter.origin(pointer),
    };
  }

  private checkFormatBesideType(
    format: string,
    type: IrWriter.ScalarType,
    pointer: string,
  ): boolean {
    const portable = portableTypeOf(format);

    if (portable === type) return true;
    const at = treeSchemasPointer(pointer, "format");

    if (portable !== undefined) {
      this.reporter.error({
        rule: "format-type",
        pointer: at,
        message: `the portable format '${format}' is a ${portable}, not a ${type}`,
        fix: `write 'type: ${portable}, format: ${format}'`,
      });
    } else if (format === PASSWORD) {
      this.passwordFormat(at);
    } else if (this.declaration(format) !== undefined) {
      this.reporter.error({
        rule: "format-type",
        pointer: treeSchemasPointer(pointer, "type"),
        message: `the named format '${format}' already states its type`,
        fix: `remove 'type' and write 'format: ${format}' alone`,
      });
    } else {
      this.unknownFormat(format, at);
    }

    return false;
  }

  private namedFormatUse(
    format: string,
    value: TreeSchemasRawObject,
    pointer: string,
  ): IrWriter.ScalarTypeUse | undefined {
    const at = treeSchemasPointer(pointer, "format");
    const portable = portableTypeOf(format);

    if (portable !== undefined) {
      this.reporter.error({
        rule: "format-type",
        pointer: at,
        message: `the portable format '${format}' is written with its type`,
        fix: `write 'type: ${portable}, format: ${format}'`,
      });

      return undefined;
    }

    if (format === PASSWORD) return this.passwordFormat(at);
    const declared = this.declaration(format);

    if (declared === undefined) return this.unknownFormat(format, at);
    const own = this.refinements(value, pointer, { type: declared.type.type, decimal: false });

    if (own === undefined) return undefined;
    const conflicts = Object.keys(own).filter((key) =>
      Object.hasOwn(declared.type.refinements, key),
    );

    for (const key of conflicts) {
      this.reporter.error({
        rule: "format-refinement",
        pointer: treeSchemasPointer(pointer, key),
        message: `the named format '${format}' already sets '${key}'`,
        fix: `remove '${key}' here, or declare another named format`,
      });
    }

    if (conflicts.length > 0) return undefined;
    const refinements = { ...structuredClone(declared.type.refinements), ...own };

    if (!this.checkRanges(refinements, declared.type.type, pointer)) return undefined;

    return { kind: "scalar", type: declared.type.type, scalar: format, refinements };
  }

  private checkRanges(
    refinements: IrWriter.Refinements,
    type: IrWriter.ScalarType,
    pointer: string,
  ): boolean {
    const empty = emptyRanges(refinements, type);

    for (const problem of empty) {
      this.reporter.error({
        rule: "refinement-range",
        pointer,
        message: `no value fits the schema: ${problem}`,
        fix: "lower the minimum or raise the maximum",
      });
    }

    return empty.length === 0;
  }

  private passwordFormat(pointer: string): undefined {
    this.reporter.error({
      rule: "format-type",
      pointer,
      message: "'password' is not authorable: it is what 'sensitive' emits",
      fix: "write 'type: string' and mark the field 'sensitive: true'",
    });

    return undefined;
  }

  private unknownFormat(format: string, pointer: string): undefined {
    this.reporter.error({
      rule: "format-unknown",
      pointer,
      message: `'${format}' is neither a portable format nor a named format of 'scalars'`,
      fix: "declare it under 'scalars', or write a portable format",
    });

    return undefined;
  }

  private refinements(
    value: TreeSchemasRawObject,
    pointer: string,
    target: RefinementTarget,
  ): IrWriter.Refinements | undefined {
    const out: IrWriter.Refinements = {};
    let refused = false;
    const misplaced = (key: string, fix = `remove '${key}'`): void => {
      refused = true;
      this.reporter.error({
        rule: "refinement-type",
        pointer: treeSchemasPointer(pointer, key),
        message: `'${key}' does not apply to ${target.decimal ? "a decimal" : `a ${target.type}`}`,
        fix,
      });
    };

    const isString = target.type === "string";
    const isNumeric = target.type === "integer" || target.type === "number" || target.decimal;

    for (const key of LENGTHS) {
      const length = value[key];

      if (typeof length !== "number") continue;

      if (isString && !target.decimal) out[key] = length;
      else misplaced(key);
    }

    if (typeof value.pattern === "string") {
      if (!isString || target.decimal) misplaced("pattern");
      else refused = !this.pattern(value.pattern, pointer, out) || refused;
    }

    for (const key of [...BOUNDS, "multipleOf"] as const) {
      const bound = value[key];

      if (typeof bound !== "number") continue;

      if (!isNumeric) misplaced(key);
      else if (key === "multipleOf" && target.type === "number")
        misplaced(key, "use 'type: integer', or 'type: string, format: decimal' for an exact step");
      else refused = !this.bound(key, bound, pointer, out) || refused;
    }

    return refused ? undefined : out;
  }

  private pattern(source: string, pointer: string, out: IrWriter.Refinements): boolean {
    const normalized = treeSchemasNormalizePattern(source);

    if (normalized.ok) {
      out.pattern = { source, normalized: normalized.normalized };

      return true;
    }

    this.reporter.error({
      rule: "pattern",
      pointer: treeSchemasPointer(pointer, "pattern"),
      message: `the pattern is not portable: ${normalized.reason}`,
      fix: "rewrite it in the portable subset of ADR 0003 section 9",
    });

    return false;
  }

  private bound(
    key: (typeof BOUNDS)[number] | "multipleOf",
    bound: number,
    pointer: string,
    out: IrWriter.Refinements,
  ): boolean {
    const literal = treeSchemasDecimalLiteral(bound);

    if (literal !== undefined) {
      out[key] = literal;

      return true;
    }

    const integer = Number.isInteger(bound);

    this.reporter.error({
      rule: "refinement-precision",
      pointer: treeSchemasPointer(pointer, key),
      message: integer
        ? `'${key}' is an integer beyond the safe range, whose written digits the contract reader cannot keep`
        : `'${key}' has more significant digits than the contract reader keeps`,
      fix: integer
        ? "write a bound between -(2^53 - 1) and 2^53 - 1"
        : `write the bound with at most ${MAX_FRACTION_DIGITS} significant digits`,
    });

    return false;
  }
}

/** The docs of a schema: its `title` as the summary, and its `description`. */
export function treeSchemasDocs(value: TreeSchemasRaw | undefined): IrWriter.Docs {
  const title = treeSchemasMember(value, "title");
  const description = treeSchemasMember(value, "description");

  return {
    ...(typeof title === "string" ? { summary: title } : {}),
    ...(typeof description === "string" ? { description } : {}),
  };
}
