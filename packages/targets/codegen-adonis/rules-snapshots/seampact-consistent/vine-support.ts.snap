// The VineJS support of the validators the AdonisJS target writes itself: one boundary-owned `Vine` instance, and the
// Standard Schema that builds a VineJS schema from a generated shape, validates without conversion, keeps the declared
// keys only and names each issue by its contract rule, the convention a server boundary renders (`code: "custom"`
// with `params.rule`, `unrecognized_keys` with `keys`). The app's global VineJS settings never reach it. A check the
// generator marks `native` (`rules: native`) is VineJS's own rule and count, reported with the plan's message.
import { errors, SimpleMessagesProvider, Vine } from "@vinejs/vine";
import type { FieldContext, SchemaTypes } from "@vinejs/vine/types";
import { codePointLength, isDateTime, isIntegerMultiple } from "./wire-checks.js";

const UNKNOWN_KEYS_CODE = "unrecognized_keys";
const UNKNOWN_KEYS_RULE = "unknownKeys";
// A rule this module reports carries the contract rule's name under this prefix, so VineJS's own message for a rule of
// the same name (`maxLength`) never replaces the plan's.
const CONTRACT_RULE_PREFIX = "contract.";
const SAFE_INTEGER_LIMIT = Number.MAX_SAFE_INTEGER;
// VineJS fills every `{{ name }}` of a message, and drops a backslash before one: a plan message carries its
// backslashes and opening braces as these placeholders, which VineJS fills back with the characters.
const LITERAL_CHARACTERS: Readonly<Record<string, string>> = {
  backslash: "\\",
  openingBrace: "{",
};

type BoundRule = "minimum" | "maximum" | "exclusiveMinimum" | "exclusiveMaximum";

type ShapeCheck =
  | {
      readonly rule: "format";
      readonly format: "uuid" | "date-time";
      readonly message: string;
      readonly layout?: string;
      readonly native?: true;
    }
  | {
      readonly rule: "minLength" | "maxLength";
      readonly limit: number;
      readonly message: string;
      readonly native?: true;
    }
  | {
      readonly rule: "pattern";
      readonly normalized: string;
      readonly message: string;
      readonly native?: true;
    }
  | { readonly rule: BoundRule; readonly literal: string; readonly native?: true }
  | {
      readonly rule: "multipleOf";
      readonly literal: string;
      readonly integerStep: string;
      readonly message: string;
    };

interface ShapeField {
  readonly key: string;
  readonly optional: boolean;
  readonly type: Shape;
}

export type Shape =
  | { readonly kind: "unknown"; readonly nullable: boolean }
  | {
      readonly kind: "object";
      readonly unknownKeys: "refuse" | "strip";
      readonly fields: readonly ShapeField[];
    }
  | { readonly kind: "enum"; readonly values: readonly string[]; readonly open: boolean }
  | {
      readonly kind: "array";
      readonly items: Shape;
      readonly minItems?: number;
      readonly maxItems?: number;
    }
  | {
      readonly kind: "scalar";
      readonly base: "string" | "integer" | "number" | "boolean";
      readonly checks: readonly ShapeCheck[];
    };

export interface InputIssue {
  readonly message: string;
  readonly path: readonly string[];
  readonly code: "custom" | typeof UNKNOWN_KEYS_CODE;
  readonly params?: { readonly rule: string };
  readonly keys?: readonly string[];
}

export type InputResult = { readonly value: unknown } | { readonly issues: readonly InputIssue[] };

export interface InputStandardSchema {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: "vinejs";
    readonly validate: (value: unknown) => Promise<InputResult>;
  };
}

const vine = new Vine();

// The default provider looks a field's label up in a plain object, so a member named `valueOf` would read with the
// source of `Object.prototype.valueOf`: no custom message and no label, the field reads with its own name.
vine.messagesProvider = new SimpleMessagesProvider(
  Object.setPrototypeOf({}, null),
  Object.setPrototypeOf({}, null),
);

// VineJS's own rules to the contract rule; a missing value is told from a null one by the candidate.
const RULE_OF_VINE_RULE: ReadonlyMap<string, string> = new Map([
  ["required", "required"],
  ["string", "type"],
  ["number", "type"],
  ["boolean", "type"],
  ["array", "type"],
  ["object", "type"],
  ["withoutDecimals", "type"],
  ["enum", "enum"],
  ["array.minLength", "minItems"],
  ["array.maxLength", "maxItems"],
  ["minLength", "minLength"],
  ["maxLength", "maxLength"],
  ["regex", "pattern"],
  ["uuid", "format"],
  ["min", "minimum"],
  ["max", "maximum"],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A plan message as VineJS reports it unchanged.
function literalMessage(planMessage: string): string {
  return planMessage.replace(/[\\{]/g, (character) =>
    character === "{" ? "{{ openingBrace }}" : "{{ backslash }}",
  );
}

// A rule over one value: `holds` is false for a value the rule refuses. A value of another type is left to the
// type check.
function checkRule(rule: string, message: string, holds: (value: unknown) => boolean) {
  return vine.createRule(
    (value: unknown, _options: undefined, field: FieldContext) => {
      if (!holds(value))
        field.report(message, CONTRACT_RULE_PREFIX + rule, field, LITERAL_CHARACTERS);
    },
    { name: rule },
  )();
}

const REFUSES_NULL = vine.createRule(
  (value: unknown, _options: undefined, field: FieldContext) => {
    if (value === null)
      field.report("The {{ field }} field must not be null", `${CONTRACT_RULE_PREFIX}type`, field);
  },
  { name: "type", implicit: true },
)();

// A required member of an opaque type may hold any value, `null` included: it must only be present.
const IS_PRESENT = vine.createRule(
  (_value: unknown, _options: undefined, field: FieldContext) => {
    if (!isRecord(field.parent) || !Object.hasOwn(field.parent, field.name)) {
      field.report(
        "The {{ field }} field must be defined",
        `${CONTRACT_RULE_PREFIX}required`,
        field,
      );
    }
  },
  { name: "required", implicit: true },
)();

// VineJS drops the keys a schema does not declare; a `refuse` object reports each one instead.
function refusesUnknownKeys(declared: readonly string[]) {
  return vine.createRule(
    (value: unknown, _options: undefined, field: FieldContext) => {
      if (!isRecord(value)) return;

      const keys = Object.keys(value).filter((key) => !declared.includes(key));

      if (keys.length > 0) {
        field.report(
          "The {{ field }} field has unknown keys",
          CONTRACT_RULE_PREFIX + UNKNOWN_KEYS_RULE,
          field,
          {
            keys,
          },
        );
      }
    },
    { name: UNKNOWN_KEYS_RULE, implicit: true },
  )();
}

// Where a schema stands: a member that must be present, a member that may be absent, or an array item.
type Position = "required" | "optional" | "item";

type Rule = ReturnType<typeof checkRule>;

interface CanBeOptional {
  optional(): { use(rule: Rule): object };
}

// VineJS's own types do not accept an optional schema where a schema is expected once `exactOptionalPropertyTypes`
// is on, although it is one: this checks the members the compiler reads, and narrows to the schema type.
function isSchema(candidate: object): candidate is SchemaTypes {
  return (
    typeof Reflect.get(candidate, "clone") === "function" &&
    typeof Reflect.get(candidate, "toJSONSchema") === "function"
  );
}

function accepted(candidate: object): SchemaTypes {
  if (!isSchema(candidate)) {
    throw new Error(
      "codegen-adonis: a VineJS schema lacks its schema members; this is a renderer bug.",
    );
  }

  return candidate;
}

// VineJS reads `null` as missing: an optional member must refuse it itself.
function atPosition(schema: CanBeOptional & object, position: Position): SchemaTypes {
  return accepted(position === "optional" ? schema.optional().use(REFUSES_NULL) : schema);
}

function build(shape: Shape, position: Position): SchemaTypes {
  switch (shape.kind) {
    case "unknown":
      return opaqueSchema(shape, position);
    case "enum":
      return atPosition(shape.open ? vine.string() : vine.enum(shape.values), position);
    case "array":
      return atPosition(arraySchema(shape), position);
    case "scalar":
      return atPosition(scalarSchema(shape), position);
    case "object":
      return atPosition(objectSchema(shape), position);
  }
}

// An opaque value is any JSON value, `null` included, which VineJS reads as missing: it is optional to VineJS, and
// the rules tell a missing member, a null and a value.
function opaqueSchema(shape: Extract<Shape, { kind: "unknown" }>, position: Position): SchemaTypes {
  const rules = [
    ...(shape.nullable ? [] : [REFUSES_NULL]),
    ...(position === "required" ? [IS_PRESENT] : []),
  ];

  return accepted(rules.reduce((schema, rule) => schema.use(rule), vine.any().optional()));
}

function arraySchema(shape: Extract<Shape, { kind: "array" }>) {
  const array = vine.array(build(shape.items, "item")).bail(false);

  if (shape.minItems !== undefined) array.minLength(shape.minItems);

  if (shape.maxItems !== undefined) array.maxLength(shape.maxItems);

  return array;
}

function objectSchema(shape: Extract<Shape, { kind: "object" }>) {
  const properties = Object.fromEntries(
    shape.fields.map((field) => [
      field.key,
      build(field.type, field.optional ? "optional" : "required"),
    ]),
  );
  const object = vine.object(properties);

  if (shape.unknownKeys === "strip") return object;

  // Without `bail(false)` a refused key would hide the issues of the members below it.
  return object
    .allowUnknownProperties()
    .bail(false)
    .use(refusesUnknownKeys(shape.fields.map((field) => field.key)));
}

function scalarSchema(shape: Extract<Shape, { kind: "scalar" }>) {
  switch (shape.base) {
    case "boolean":
      return vine.boolean({ strict: true });
    case "string":
      return shape.checks.reduce(withStringCheck, vine.string().bail(false));
    case "integer":
    case "number":
      return numericSchema(shape);
  }
}

function numericSchema(shape: Extract<Shape, { kind: "scalar" }>) {
  const integer = shape.base === "integer";
  const base = integer
    ? vine.number({ strict: true }).withoutDecimals()
    : vine.number({ strict: true });
  const rules = integer
    ? [
        ...shape.checks.filter((check) => !isBound(check)).map(numericRule),
        ...safeIntegerRules(shape.checks),
      ]
    : shape.checks.filter((check) => !isNativeBound(check)).map(numericRule);
  const checked = rules.reduce((schema, rule) => schema.use(rule), base.bail(false));

  return nativeBounds(shape, integer).reduce(withNativeBound, checked);
}

function isBound(check: ShapeCheck): boolean {
  return check.rule === "minimum" || check.rule === "maximum";
}

// A check the generator marked for VineJS's own rule; `multipleOf` never is, VineJS having no rule for it.
function isNative(check: ShapeCheck): boolean {
  return "native" in check && check.native === true;
}

function isNativeBound(check: ShapeCheck): boolean {
  return isBound(check) && isNative(check);
}

// The bounds VineJS's own `min` and `max` check: on an integer, only a bound inside the safe range, since the safe
// range check stands for a looser one.
function nativeBounds(shape: Extract<Shape, { kind: "scalar" }>, integer: boolean) {
  return shape.checks.filter((check) => isNativeBound(check) && (!integer || isSafeBound(check)));
}

function isSafeBound(check: ShapeCheck): boolean {
  return "literal" in check && Math.abs(Number(check.literal)) <= SAFE_INTEGER_LIMIT;
}

type VineNumber = ReturnType<typeof vine.number>;

function withNativeBound(schema: VineNumber, check: ShapeCheck): VineNumber {
  if (!("literal" in check)) return schema;

  return check.rule === "minimum"
    ? schema.min(Number(check.literal))
    : schema.max(Number(check.literal));
}

type VineString = ReturnType<typeof vine.string>;

function withStringCheck(schema: VineString, check: ShapeCheck): VineString {
  if (!isNative(check)) return schema.use(stringRule(check));

  switch (check.rule) {
    case "minLength":
      return schema.minLength(check.limit);
    case "maxLength":
      return schema.maxLength(check.limit);
    case "pattern":
      return schema.regex(new RegExp(check.normalized, "u"));
    case "format":
      if (check.format === "uuid") return schema.uuid();

      throw new Error(
        "codegen-adonis: the format '" +
          check.format +
          "' has no VineJS rule; this is a renderer bug.",
      );
    default:
      throw new Error(
        "codegen-adonis: the native rule '" +
          check.rule +
          "' is not a string check; this is a renderer bug.",
      );
  }
}

function stringRule(check: ShapeCheck) {
  switch (check.rule) {
    case "minLength":
      return checkRule(
        check.rule,
        literalMessage(check.message),
        (value) => typeof value !== "string" || codePointLength(value) >= check.limit,
      );
    case "maxLength":
      return checkRule(
        check.rule,
        literalMessage(check.message),
        (value) => typeof value !== "string" || codePointLength(value) <= check.limit,
      );
    case "pattern": {
      const pattern = new RegExp(check.normalized, "u");

      return checkRule(
        check.rule,
        literalMessage(check.message),
        (value) => typeof value !== "string" || pattern.test(value),
      );
    }

    case "format":
      return checkRule(check.rule, literalMessage(check.message), formatTest(check));
    default:
      throw new Error(
        "codegen-adonis: the string rule '" +
          check.rule +
          "' is not a string check; this is a renderer bug.",
      );
  }
}

function formatTest(check: Extract<ShapeCheck, { rule: "format" }>): (value: unknown) => boolean {
  if (check.format === "date-time")
    return (value) => typeof value !== "string" || isDateTime(value);

  if (check.layout === undefined) {
    throw new Error("codegen-adonis: the uuid format carries no layout; this is a renderer bug.");
  }

  const layout = new RegExp(check.layout);

  return (value) => typeof value !== "string" || layout.test(value);
}

// A plain integer is in the safe range of ADR 0003, reported as `minimum` and `maximum`; a bound of the contract
// inside that range stands as written. A side VineJS's own `min` or `max` checks inside that range needs no check here.
function safeIntegerRules(checks: readonly ShapeCheck[]) {
  const declaredCheck = (rule: "minimum" | "maximum") =>
    checks.find((candidate) => candidate.rule === rule);

  const declared = (rule: "minimum" | "maximum"): number | undefined => {
    const check = declaredCheck(rule);

    return check?.rule === rule ? Number(check.literal) : undefined;
  };

  const checkedNatively = (rule: "minimum" | "maximum"): boolean => {
    const check = declaredCheck(rule);

    return check !== undefined && isNativeBound(check) && isSafeBound(check);
  };

  const minimum = Math.max(declared("minimum") ?? -SAFE_INTEGER_LIMIT, -SAFE_INTEGER_LIMIT);
  const maximum = Math.min(declared("maximum") ?? SAFE_INTEGER_LIMIT, SAFE_INTEGER_LIMIT);

  return [
    ...(checkedNatively("minimum")
      ? []
      : [
          checkRule(
            "minimum",
            `The {{ field }} field must be at least ${minimum}`,
            (value) => typeof value !== "number" || value >= minimum,
          ),
        ]),
    ...(checkedNatively("maximum")
      ? []
      : [
          checkRule(
            "maximum",
            `The {{ field }} field must be at most ${maximum}`,
            (value) => typeof value !== "number" || value <= maximum,
          ),
        ]),
  ];
}

// A step is the plan's: an integer's step reduced to an exact integer, which the shared check tests with an exact
// remainder; the plan refuses a step on a number.
function numericRule(check: ShapeCheck) {
  if (check.rule === "multipleOf") {
    return checkRule(
      check.rule,
      literalMessage(check.message),
      (value) => typeof value !== "number" || isIntegerMultiple(value, check.integerStep),
    );
  }

  if (!("literal" in check)) {
    throw new Error(
      "codegen-adonis: the rule '" +
        check.rule +
        "' is not a numeric check; this is a renderer bug.",
    );
  }

  const limit = Number(check.literal);
  const message = `The {{ field }} field must satisfy ${check.rule} ${check.literal}`;

  switch (check.rule) {
    case "minimum":
      return checkRule(check.rule, message, (value) => typeof value !== "number" || value >= limit);
    case "maximum":
      return checkRule(check.rule, message, (value) => typeof value !== "number" || value <= limit);
    case "exclusiveMinimum":
      return checkRule(check.rule, message, (value) => typeof value !== "number" || value > limit);
    case "exclusiveMaximum":
      return checkRule(check.rule, message, (value) => typeof value !== "number" || value < limit);
  }
}

// The value a handler receives: a copy holding the declared keys only, with VineJS's conversions never applied.
function declaredValue(shape: Shape, value: unknown): unknown {
  if (shape.kind === "array" && Array.isArray(value))
    return value.map((item) => declaredValue(shape.items, item));

  if (shape.kind !== "object" || !isRecord(value)) return value;

  return Object.fromEntries(
    shape.fields
      .filter((field) => Object.hasOwn(value, field.key))
      .map((field) => [field.key, declaredValue(field.type, value[field.key])]),
  );
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      Array.isArray(current) ? current[Number(key)] : isRecord(current) ? current[key] : undefined,
    value,
  );
}

interface VineMessage {
  readonly message: string;
  readonly rule: string;
  readonly field: string;
  readonly meta?: Record<string, unknown>;
}

function shapeAt(shape: Shape, path: readonly string[]): Shape | undefined {
  const [key, ...rest] = path;

  if (key === undefined) return shape;

  const inner =
    shape.kind === "object"
      ? shape.fields.find((field) => field.key === key)?.type
      : shape.kind === "array"
        ? shape.items
        : undefined;

  return inner === undefined ? undefined : shapeAt(inner, rest);
}

// The plan's message of a check VineJS's own rule made, so a rule reads the same in both modes; a bound has none.
function nativeMessage(shape: Shape, path: readonly string[], rule: string): string | undefined {
  const scalar = shapeAt(shape, path);

  if (scalar?.kind !== "scalar") return undefined;

  const check = scalar.checks.find((candidate) => isNative(candidate) && candidate.rule === rule);

  return check !== undefined && "message" in check ? check.message : undefined;
}

// VineJS reports a null value as missing; the contract calls it a wrong type, or a value outside the enum.
function ruleOfMissing(shape: Shape, candidate: unknown, path: readonly string[]): string {
  if (valueAt(candidate, path) !== null) return "required";

  return shapeAt(shape, path)?.kind === "enum" ? "enum" : "type";
}

function issueOf(shape: Shape, candidate: unknown, error: VineMessage): InputIssue {
  const path = error.field === "" ? [] : error.field.split(".");

  const reported = error.rule.startsWith(CONTRACT_RULE_PREFIX)
    ? error.rule.slice(CONTRACT_RULE_PREFIX.length)
    : undefined;

  if (reported === UNKNOWN_KEYS_RULE) {
    const keys = error.meta?.keys;

    return {
      message: error.message,
      path,
      code: UNKNOWN_KEYS_CODE,
      keys: Array.isArray(keys) ? keys.map(String) : [],
    };
  }

  const known = reported ?? RULE_OF_VINE_RULE.get(error.rule);

  if (known === undefined) {
    throw new Error(
      "codegen-adonis: the VineJS rule '" +
        error.rule +
        "' has no contract rule; this is a renderer bug.",
    );
  }

  const rule = known === "required" ? ruleOfMissing(shape, candidate, path) : known;
  const message =
    (reported === undefined ? nativeMessage(shape, path, rule) : undefined) ?? error.message;

  return { message, path, code: "custom", params: { rule } };
}

// A value of the wrong type reports its type alone.
function issuesOf(
  shape: Shape,
  candidate: unknown,
  messages: readonly VineMessage[],
): InputIssue[] {
  const issues = messages.map((message) => issueOf(shape, candidate, message));
  const typeFailures = new Set(
    issues.filter((issue) => issue.params?.rule === "type").map((issue) => issue.path.join(".")),
  );

  return issues.filter(
    (issue) => issue.params?.rule === "type" || !typeFailures.has(issue.path.join(".")),
  );
}

// VineJS reads `value[key]`, so a member named `toString` would be read from `Object.prototype` when absent: the
// candidate is validated as a copy whose objects have no prototype.
function withoutPrototypes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPrototypes);

  if (!isRecord(value)) return value;

  const copy: Record<string, unknown> = Object.setPrototypeOf({}, null);

  for (const [key, member] of Object.entries(value)) copy[key] = withoutPrototypes(member);

  return copy;
}

// Compiled once, when the module loads.
export function vineStandardSchema(shape: Shape): InputStandardSchema {
  const validator = vine.create(build(shape, "required"));

  return {
    "~standard": {
      version: 1,
      vendor: "vinejs",
      async validate(value) {
        const candidate = withoutPrototypes(value);

        try {
          await validator.validate(candidate);
        } catch (error) {
          if (!(error instanceof errors.E_VALIDATION_ERROR)) throw error;

          return { issues: issuesOf(shape, candidate, error.messages) };
        }

        return { value: declaredValue(shape, value) };
      },
    },
  };
}
