import type { IrWriter } from "@seampact/spec/ir";
import type { TreeSchemaExampleIssue } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import type { TreeSchemasExampleCheck, TreeSchemasWrittenValue } from "./compile.js";
import {
  type TreeSchemasDecimal,
  treeSchemasCompareDecimals,
  treeSchemasDecimalOf,
  treeSchemasIsMultipleOf,
} from "./decimal.js";
import { type TreeSchemasReporter, treeSchemasPointer } from "./raw.js";

// Example values parsed against a type use with the strict input rules (ADR 0003 section 11): unknown keys,
// unknown enum members and union tags, a missing required property and a value outside a refinement are refused.
// `int64` is read as a string, its default wire form; `email`, `uri` and `uri-reference` are checked as strings
// only, until `@seampact/spec` publishes the format table their patterns come from.

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
const DATE_TIME =
  /^([0-9]{4}-[0-9]{2}-[0-9]{2})[Tt]([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?(?:[Zz]|[+-]([0-9]{2}):([0-9]{2}))$/;
const INT64 = /^-?(0|[1-9][0-9]*)$/;
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
// A JSON number, the text form of a number on the wire.
const NUMBER_TEXT = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const BOOLEAN_TEXT: Readonly<Record<string, boolean>> = { true: true, false: false };
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const HOURS = 24;
const MINUTES = 60;

const BOUND_CHECKS = [
  ["minimum", (order: number) => order >= 0, "at least"],
  ["exclusiveMinimum", (order: number) => order > 0, "above"],
  ["maximum", (order: number) => order <= 0, "at most"],
  ["exclusiveMaximum", (order: number) => order < 0, "below"],
] as const;

// A text read by its wire form: the value it stands for, or why it stands for none.
type TextReading = { value: unknown } | { problem: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isCalendarDate(text: string): boolean {
  const match = DATE.exec(text);

  if (match === null) return false;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

// RFC 3339 `date-time` as ADR 0003 section 8 reads it: an offset is required, a leap second refused.
function isDateTime(text: string): boolean {
  const match = DATE_TIME.exec(text);

  if (match === null) return false;
  const [date = "", hour, minute, second, offsetHour = "0", offsetMinute = "0"] = match.slice(1);

  return (
    isCalendarDate(date) &&
    Number(hour) < HOURS &&
    Number(minute) < MINUTES &&
    Number(second) < MINUTES &&
    Number(offsetHour) < HOURS &&
    Number(offsetMinute) < MINUTES
  );
}

const FORMAT_CHECKS: Readonly<Record<string, (text: string) => boolean>> = {
  uuid: (text) => UUID.test(text),
  date: isCalendarDate,
  "date-time": isDateTime,
  decimal: (text) => DECIMAL.test(text),
  int64: (text) => INT64.test(text) && BigInt(text) >= INT64_MIN && BigInt(text) <= INT64_MAX,
};

/** Checks values against type uses over the compiled schemas and enums, which it never changes. */
export class TreeSchemasExampleChecker {
  constructor(
    private readonly schemas: ReadonlyMap<string, IrWriter.Schema>,
    private readonly enums: ReadonlyMap<string, IrWriter.Enum>,
  ) {}

  /** The issues of `value` against `use`, each at its pointer inside the value; empty when it fits. */
  check(value: unknown, use: IrWriter.TypeUse): TreeSchemaExampleIssue[] {
    const issues: TreeSchemaExampleIssue[] = [];

    this.use(value, use, "", issues);

    return issues;
  }

  /**
   * The issues of a text, a path segment, a query value or a key, read by the use's wire form: a string, an
   * `int64`, a decimal or an enum value as written, a number or a boolean as its JSON text. Only a scalar or an
   * enum use has a text form.
   */
  checkText(text: string, use: IrWriter.TypeUse): TreeSchemaExampleIssue[] {
    const read = this.textValue(text, use);

    return "problem" in read
      ? [{ pointer: "", message: read.problem }]
      : this.check(read.value, use);
  }

  private textValue(text: string, use: IrWriter.TypeUse): TextReading {
    if (use.kind === "enum") return { value: text };

    if (use.kind !== "scalar") return { problem: `a ${use.kind} use has no text form` };

    if (use.type === "string" || use.format === "int64") return { value: text };

    if (use.type === "boolean")
      return Object.hasOwn(BOOLEAN_TEXT, text)
        ? { value: BOOLEAN_TEXT[text] }
        : { problem: `${quote(text)} is not 'true' or 'false'` };

    return NUMBER_TEXT.test(text)
      ? { value: Number(text) }
      : { problem: `${quote(text)} is not a number` };
  }

  private use(
    value: unknown,
    use: IrWriter.TypeUse,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    if (use.kind === "opaque") return;

    if (value === null) {
      if (use.nullable !== true) issues.push({ pointer, message: "the value may not be null" });

      return;
    }

    switch (use.kind) {
      case "ref":
        this.schema(value, use.schema, pointer, issues);

        return;
      case "file":
        // A file is not JSON: an example names or holds its content as text.
        if (typeof value !== "string")
          issues.push({ pointer, message: "a file example is a string" });

        return;
      case "enum":
        this.enumValue(value, use, pointer, issues);

        return;
      case "array":
        this.array(value, use, pointer, issues);

        return;
      case "scalar":
        this.scalar(value, use, pointer, issues);

        return;
    }
  }

  private schema(
    value: unknown,
    id: string,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    const schema = this.schemas.get(id);

    if (schema === undefined)
      throw new Error(`tree.schemas checks an example against no schema '${id}'`);

    if (schema.kind === "object") {
      this.object(value, schema, pointer, issues, undefined);

      return;
    }

    if (schema.kind === "map") {
      this.map(value, schema, pointer, issues);

      return;
    }

    this.union(value, schema, pointer, issues);
  }

  private object(
    value: unknown,
    schema: IrWriter.ObjectSchema,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
    tagProperty: string | undefined,
  ): void {
    if (!isRecord(value)) {
      issues.push({ pointer, message: `the value is not an object (${schema.id})` });

      return;
    }

    for (const key of Object.keys(value)) {
      if (key !== tagProperty && !schema.properties.some((property) => property.name === key))
        issues.push({
          pointer: treeSchemasPointer(pointer, key),
          message: `${quote(key)} is not a property of ${schema.id}`,
        });
    }

    for (const property of schema.properties) {
      if (!Object.hasOwn(value, property.name)) {
        if (!property.optional)
          issues.push({
            pointer,
            message: `the required property ${quote(property.name)} is missing`,
          });
        continue;
      }

      const at = treeSchemasPointer(pointer, property.name);
      const field = value[property.name];

      if (field === null && property.nullable) continue;
      this.use(field, property.type, at, issues);
    }
  }

  private map(
    value: unknown,
    schema: IrWriter.MapSchema,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    if (!isRecord(value)) {
      issues.push({ pointer, message: `the value is not an object (${schema.id})` });

      return;
    }

    for (const [key, entry] of Object.entries(value)) {
      const at = treeSchemasPointer(pointer, key);

      if (schema.keys !== undefined) {
        for (const issue of this.check(key, schema.keys))
          issues.push({
            pointer: at,
            message: `the key ${quote(key)} does not fit: ${issue.message}`,
          });
      }

      this.use(entry, schema.values, at, issues);
    }
  }

  // A header-tagged union reads its tag outside the value, so the value fits when it fits one variant.
  private union(
    value: unknown,
    schema: IrWriter.UnionSchema,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    if (schema.tag.in === "header") {
      const fits = schema.variants.some(
        (variant) => this.check(value, { kind: "ref", schema: variant.schema }).length === 0,
      );

      if (!fits) issues.push({ pointer, message: `the value fits no variant of ${schema.id}` });

      return;
    }

    const property = schema.tag.property;

    if (!isRecord(value) || typeof value[property] !== "string") {
      issues.push({
        pointer,
        message: `the value holds no tag ${quote(property)} of ${schema.id}`,
      });

      return;
    }

    const tag = value[property];
    const variant = schema.variants.find((candidate) => candidate.tag === tag);
    const variantSchema = variant === undefined ? undefined : this.schemas.get(variant.schema);

    if (variantSchema?.kind !== "object") {
      issues.push({
        pointer: treeSchemasPointer(pointer, property),
        message: `${quote(tag)} is no tag of ${schema.id}`,
      });

      return;
    }

    this.object(value, variantSchema, pointer, issues, property);
  }

  private enumValue(
    value: unknown,
    use: IrWriter.EnumTypeUse,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    const values = use.narrowedTo?.values ?? this.enums.get(use.enum)?.values;

    if (values === undefined)
      throw new Error(`tree.schemas checks an example against no enum '${use.enum}'`);

    if (typeof value !== "string" || !values.includes(value))
      issues.push({ pointer, message: `${quote(value)} is not a value of ${use.enum}` });
  }

  private array(
    value: unknown,
    use: IrWriter.ArrayTypeUse,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    if (!Array.isArray(value)) {
      issues.push({ pointer, message: "the value is not an array" });

      return;
    }

    if (use.minItems !== undefined && value.length < use.minItems)
      issues.push({ pointer, message: `the array holds fewer than ${use.minItems} items` });

    if (use.maxItems !== undefined && value.length > use.maxItems)
      issues.push({ pointer, message: `the array holds more than ${use.maxItems} items` });

    for (const [index, item] of value.entries())
      this.use(item, use.items, treeSchemasPointer(pointer, String(index)), issues);
  }

  private scalar(
    value: unknown,
    use: IrWriter.ScalarTypeUse,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    const problem = this.scalarProblem(value, use);

    if (problem !== undefined) {
      issues.push({ pointer, message: problem });

      return;
    }

    if (use.content !== undefined && typeof value === "string")
      this.content(value, use.content, pointer, issues);
  }

  private scalarProblem(value: unknown, use: IrWriter.ScalarTypeUse): string | undefined {
    const stringTyped = use.type === "string" || use.format === "int64";

    if (stringTyped) {
      if (typeof value !== "string")
        return `${quote(value)} is not a string${use.format === "int64" ? " (an int64 is sent as a string)" : ""}`;

      return this.stringProblem(value, use);
    }

    if (use.type === "boolean")
      return typeof value === "boolean" ? undefined : `${quote(value)} is not a boolean`;

    if (typeof value !== "number" || !Number.isFinite(value))
      return `${quote(value)} is not a number`;

    if (use.type === "integer" && !Number.isSafeInteger(value))
      return `${quote(value)} is not an integer in the safe range`;

    return this.boundsProblem(value, use.refinements);
  }

  private stringProblem(value: string, use: IrWriter.ScalarTypeUse): string | undefined {
    const format = use.format;
    const formatCheck =
      format !== undefined && Object.hasOwn(FORMAT_CHECKS, format)
        ? FORMAT_CHECKS[format]
        : undefined;

    if (formatCheck !== undefined && !formatCheck(value))
      return `${quote(value)} is not a valid ${format}`;
    const { minLength, maxLength, pattern } = use.refinements;
    const length = [...value].length;

    if (minLength !== undefined && length < minLength)
      return `${quote(value)} is shorter than ${minLength} characters`;

    if (maxLength !== undefined && length > maxLength)
      return `${quote(value)} is longer than ${maxLength} characters`;

    if (pattern !== undefined && !new RegExp(pattern.normalized, "u").test(value))
      return `${quote(value)} does not match the pattern ${quote(pattern.source)}`;

    return format === "int64" || format === "decimal"
      ? this.boundsProblem(value, use.refinements)
      : undefined;
  }

  // Every issue of the JSON text is reported at the string that holds it.
  private content(
    value: string,
    content: IrWriter.JsonContent,
    pointer: string,
    issues: TreeSchemaExampleIssue[],
  ): void {
    let parsed: unknown;

    try {
      parsed = JSON.parse(value);
    } catch (error) {
      const reason = error instanceof Error ? `: ${error.message}` : "";

      issues.push({ pointer, message: `the value is not JSON text${reason}` });

      return;
    }

    for (const issue of this.check(parsed, content.schema))
      issues.push({
        pointer,
        message: `the JSON text does not fit at ${quote(issue.pointer)}: ${issue.message}`,
      });
  }

  private boundsProblem(
    value: number | string,
    refinements: IrWriter.Refinements,
  ): string | undefined {
    const decimal = treeSchemasDecimalOf(value);

    if (decimal === undefined) return `${quote(value)} is not a decimal number`;

    for (const [key, fits, words] of BOUND_CHECKS) {
      const bound = boundOf(refinements[key]);

      if (bound !== undefined && !fits(treeSchemasCompareDecimals(decimal, bound)))
        return `${quote(value)} is not ${words} ${refinements[key]}`;
    }

    const step = boundOf(refinements.multipleOf);

    if (step !== undefined && !treeSchemasIsMultipleOf(decimal, step))
      return `${quote(value)} is not a multiple of ${refinements.multipleOf}`;

    return undefined;
  }
}

function boundOf(literal: string | undefined): TreeSchemasDecimal | undefined {
  return literal === undefined ? undefined : treeSchemasDecimalOf(literal);
}

const WRITTEN_FIX: Readonly<Record<TreeSchemasWrittenValue, string>> = {
  example: "correct the example, or the schema it is parsed against",
  default: "correct the default, or the schema it is parsed against",
};

/**
 * Parses every example and default the run wrote against its use: each issue fails compilation at its pointer
 * inside the value, or at the deepest node of it the tree holds (a missing property is reported at its object).
 */
export function treeSchemasCheckWrittenExamples(
  checks: readonly TreeSchemasExampleCheck[],
  checker: TreeSchemasExampleChecker,
  reporter: TreeSchemasReporter,
): void {
  for (const { pointer, value, use, written } of checks) {
    for (const issue of checker.check(value, use)) {
      const inside = `${pointer}${issue.pointer}`;

      reporter.error({
        rule: `${written}-value`,
        pointer: reporter.resolves(inside) ? inside : pointer,
        message: `the ${written} does not fit its schema at ${quote(issue.pointer)}: ${issue.message}`,
        fix: WRITTEN_FIX[written],
      });
    }
  }
}
