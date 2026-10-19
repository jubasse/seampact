// The contract rules class-validator has no exact decorator for, each a constraint named after its rule so an issue
// names the rule itself, and the item checks of a list of scalars. Copied into the generated tree as is.
import {
  isBoolean,
  isIn,
  isNumber,
  isObject,
  isString,
  registerDecorator,
  ValidateIf,
} from "class-validator";
import { codePointLength, isDateTime } from "./wire-checks.js";

/** One contract rule on one value: its name, the message it reports and its test. */
export interface ContractCheck {
  readonly rule: string;
  readonly message: string;
  test(value: unknown): boolean;
}

export type ScalarType = "string" | "integer" | "number" | "boolean";

export type StringFormat = "uuid" | "date-time";

/** The constraint name of a list's item checks; its context holds the checks under `ITEM_CHECKS`. */
export const ITEMS_CONSTRAINT = "items";
export const ITEM_CHECKS = "checks";

const TYPE_RULE = "type";

// The `8-4-4-4-12` layout of ADR 0003 section 8, any version and variant digit: `IsUUID` checks both. The runtime
// is emitted as is and cannot import codegen-core, so a test asserts this equals its `UUID_LAYOUT`.
const UUID_LAYOUT = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// An integer is a safe integer, as the contract's integer type reads (zod `z.int()`); past it is `minimum`/`maximum`.
const SAFE_INTEGER_LIMIT = Number.MAX_SAFE_INTEGER;

const FINITE_NUMBER = { allowNaN: false, allowInfinity: false } as const;

const SCALAR_TESTS: Readonly<Record<ScalarType, (value: unknown) => boolean>> = {
  string: isString,
  integer: Number.isInteger,
  number: (value) => isNumber(value, FINITE_NUMBER),
  boolean: isBoolean,
};

const FORMAT_TESTS: Readonly<Record<StringFormat, (value: string) => boolean>> = {
  uuid: (value) => UUID_LAYOUT.test(value),
  "date-time": isDateTime,
};

/** A property that may be absent: an absent one skips its checks, a `null` one does not (`IsOptional` would). */
export function ValidateIfPresent(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}

// A rule check passes a value of another type, which its type check reports alone.
function onStrings(test: (value: string) => boolean): (value: unknown) => boolean {
  return (value) => typeof value !== "string" || test(value);
}

function onNumbers(test: (value: number) => boolean): (value: unknown) => boolean {
  return (value) => typeof value !== "number" || test(value);
}

export function scalarTypeCheck(type: ScalarType): ContractCheck {
  return { rule: TYPE_RULE, message: `Expected a ${type}.`, test: SCALAR_TESTS[type] };
}

export function objectTypeCheck(): ContractCheck {
  return { rule: TYPE_RULE, message: "Expected an object.", test: isObject };
}

export function enumCheck(values: readonly string[]): ContractCheck {
  return {
    rule: "enum",
    message: `Expected one of ${values.join(", ")}.`,
    test: (value) => isIn(value, values),
  };
}

export function formatCheck(format: StringFormat, message: string): ContractCheck {
  return { rule: "format", message, test: onStrings(FORMAT_TESTS[format]) };
}

// String lengths count Unicode code points (ADR 0003 section 1); `MinLength` counts UTF-16 units.
export function minLengthCheck(limit: number, message: string): ContractCheck {
  return {
    rule: "minLength",
    message,
    test: onStrings((value) => codePointLength(value) >= limit),
  };
}

export function maxLengthCheck(limit: number, message: string): ContractCheck {
  return {
    rule: "maxLength",
    message,
    test: onStrings((value) => codePointLength(value) <= limit),
  };
}

export function patternCheck(normalized: string, message: string): ContractCheck {
  const pattern = new RegExp(normalized, "u");

  return { rule: "pattern", message, test: onStrings((value) => pattern.test(value)) };
}

export function minimumCheck(limit: number): ContractCheck {
  return {
    rule: "minimum",
    message: `Expected at least ${limit}.`,
    test: onNumbers((value) => value >= limit),
  };
}

export function maximumCheck(limit: number): ContractCheck {
  return {
    rule: "maximum",
    message: `Expected at most ${limit}.`,
    test: onNumbers((value) => value <= limit),
  };
}

export function exclusiveMinimumCheck(limit: number): ContractCheck {
  return {
    rule: "exclusiveMinimum",
    message: `Expected more than ${limit}.`,
    test: onNumbers((value) => value > limit),
  };
}

export function exclusiveMaximumCheck(limit: number): ContractCheck {
  return {
    rule: "exclusiveMaximum",
    message: `Expected less than ${limit}.`,
    test: onNumbers((value) => value < limit),
  };
}

export function multipleOfCheck(divisor: number): ContractCheck {
  return {
    rule: "multipleOf",
    message: `Expected a multiple of ${divisor}.`,
    test: onNumbers((value) => value % divisor === 0),
  };
}

/** The safe-integer range as a lower and an upper bound check, for an integer field or the items of a list. */
export function safeIntegerChecks(): ContractCheck[] {
  return [minimumCheck(-SAFE_INTEGER_LIMIT), maximumCheck(SAFE_INTEGER_LIMIT)];
}

/** The checks of one item that fail: its type check alone when the type is wrong, else every failing rule. */
export function failingItemChecks(
  item: unknown,
  checks: readonly ContractCheck[],
): ContractCheck[] {
  const [typeCheck, ...ruleChecks] = checks;

  if (typeCheck !== undefined && !typeCheck.test(item)) return [typeCheck];

  return ruleChecks.filter((check) => !check.test(item));
}

/** A property checked by one contract rule, reported under the rule's name. */
export function Satisfies(check: ContractCheck): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: check.rule,
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: check.message },
      validator: { validate: (value: unknown) => check.test(value) },
    });
  };
}

export function Format(format: StringFormat, message: string): PropertyDecorator {
  return Satisfies(formatCheck(format, message));
}

export function MinLength(limit: number, message: string): PropertyDecorator {
  return Satisfies(minLengthCheck(limit, message));
}

export function MaxLength(limit: number, message: string): PropertyDecorator {
  return Satisfies(maxLengthCheck(limit, message));
}

export function SafeInteger(): PropertyDecorator {
  const [lower, upper] = safeIntegerChecks();

  return (target, propertyKey) => {
    for (const check of [lower, upper]) {
      if (check !== undefined) Satisfies(check)(target, propertyKey);
    }
  };
}

/** A required property whose type is open: it must be present, and `null` is a value (`IsDefined` refuses it). */
export function Present(): PropertyDecorator {
  return Satisfies({
    rule: "required",
    message: "Expected a value.",
    test: (value) => value !== undefined,
  });
}

/** An opaque value that is not nullable: any JSON value but `null`. */
export function NotNull(): PropertyDecorator {
  return Satisfies({
    rule: TYPE_RULE,
    message: "Expected a value, not null.",
    test: (value) => value !== null,
  });
}

export function Minimum(limit: number): PropertyDecorator {
  return Satisfies(minimumCheck(limit));
}

export function Maximum(limit: number): PropertyDecorator {
  return Satisfies(maximumCheck(limit));
}

export function ExclusiveMinimum(limit: number): PropertyDecorator {
  return Satisfies(exclusiveMinimumCheck(limit));
}

export function ExclusiveMaximum(limit: number): PropertyDecorator {
  return Satisfies(exclusiveMaximumCheck(limit));
}

export function MultipleOf(divisor: number): PropertyDecorator {
  return Satisfies(multipleOfCheck(divisor));
}

// Each item of a list against its checks, the type check first. class-validator's `each` reports a failing item
// at the list, so the checks travel in the constraint's context and the adapter reports each item at its index.
export function ArrayItems(checks: readonly ContractCheck[]): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: ITEMS_CONSTRAINT,
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message: "Expected every item to match its schema.",
        context: { [ITEM_CHECKS]: checks },
      },
      validator: {
        validate: (value: unknown) =>
          !Array.isArray(value) ||
          value.every((item) => failingItemChecks(item, checks).length === 0),
      },
    });
  };
}
