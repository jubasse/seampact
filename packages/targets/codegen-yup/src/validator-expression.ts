import { propertyKey } from "@seampact/codegen-core";
import {
  CODE_POINT_LENGTH,
  type FieldPlan,
  IS_DATE_TIME,
  type ObjectPlan,
  type ScalarBase,
  type ScalarCheck,
  type ScalarPlan,
  type TypePlan,
  UUID_LAYOUT,
} from "@seampact/codegen-core/validators";
import type { YupRenderContext } from "./module-rendering.js";
import { UNKNOWN_KEYS_TEST } from "./yup-support.js";

// What a numeric rule leaves to the type check: an integer's rules skip a value that is no integer, a number's one
// that is not finite, so a value of the wrong type reports its type alone, as zod's aborting checks do.
const NUMERIC_RULE_SKIPS: Readonly<Partial<Record<ScalarBase, string>>> = {
  integer: "!Number.isInteger(value)",
  number: "!Number.isFinite(value)",
};

// A plain integer is in the safe range of ADR 0003 and a number is finite, as the zod validators read them; yup
// checks neither (JSON `1e999` is Infinity).
function safeIntegerBounds(): string {
  return [
    numericTest(
      "integer",
      "minimum",
      "Expected at least -9007199254740991.",
      "value >= -Number.MAX_SAFE_INTEGER",
    ),
    numericTest(
      "integer",
      "maximum",
      "Expected at most 9007199254740991.",
      "value <= Number.MAX_SAFE_INTEGER",
    ),
  ].join("");
}

function finiteNumberTest(): string {
  return namedTest("type", "Expected a finite number.", "Number.isFinite(value)");
}

// Every leaf is strict, so yup casts nothing: a value of another type is an issue. A query or header value
// arrives already decoded.
const BASE_VALIDATORS: Readonly<Record<ScalarBase, string>> = {
  string: "yup.string().strict()",
  integer: `yup.number().strict().integer()${safeIntegerBounds()}`,
  number: `yup.number().strict()${finiteNumberTest()}`,
  boolean: "yup.boolean().strict()",
};

// The yup validator of a planned type use, without its presence.
export function validatorExpression(plan: TypePlan, context: YupRenderContext): string {
  switch (plan.kind) {
    case "refused":
      throw new Error(
        "codegen-yup: a refused plan reached the renderer; generate returns the plan's refusals instead.",
      );
    case "unknown":
      return "yup.mixed().nullable()";
    case "schema":
      return context.referToSchema(plan.schemaId, plan.exportName);
    case "enum":
      // A named test, not `oneOf`: yup lets a nullable schema skip `oneOf`, and null must be an enum issue.
      return `yup.mixed().nullable()${namedTest("enum", "Expected one of the declared values.", `(${JSON.stringify(plan.values)} as readonly unknown[]).includes(value)`)}`;
    case "scalar":
      return scalarValidator(plan, context);
    case "array": {
      const items = presentValidator(plan.items, context);
      const minimum = plan.minItems === undefined ? "" : `.min(${plan.minItems})`;
      const maximum = plan.maxItems === undefined ? "" : `.max(${plan.maxItems})`;

      // Not strict: an array of objects is cast item by item, which strips the undeclared keys of an output.
      return `yup.array().of(${items})${minimum}${maximum}`;
    }
  }
}

// An item or a field that must be there; an opaque value too, where null is valid but a missing one is not.
function presentValidator(plan: TypePlan, context: YupRenderContext): string {
  return `${validatorExpression(plan, context)}.defined()`;
}

// `{ key: validator, ... }` inside the constructor of the object's unknown keys policy. Neither policy adds a
// refinement `.shape`, `.pick`, `.omit` or `.concat` would lose: the unknown keys test reads the fields of the
// schema it runs on (A45). An undeclared object stays `undefined` rather than becoming `{}`.
export function objectExpression(plan: ObjectPlan, context: YupRenderContext): string {
  const object = `yup.object({\n${fieldMembers(plan.fields, context)}\n})`;

  return plan.unknownKeys === "refuse"
    ? `${object}.strict().default(undefined).test(${context.supportName(UNKNOWN_KEYS_TEST)})`
    : `${object}.noUnknown().default(undefined)`;
}

export function fieldMembers(fields: readonly FieldPlan[], context: YupRenderContext): string {
  return fields
    .map((field) => `${propertyKey(field.key)}: ${fieldValidator(field, context)},`)
    .join("\n");
}

// A property is `.defined()` or `.optional()`, never `.required()`, which refuses an empty string with a rule the
// contract does not have.
function fieldValidator(field: FieldPlan, context: YupRenderContext): string {
  if (field.optional) return `${validatorExpression(field.type, context)}.optional()`;

  return presentValidator(field.type, context);
}

function scalarValidator(plan: ScalarPlan, context: YupRenderContext): string {
  const checks = plan.checks.map((check) => scalarCheck(check, plan.base, context));

  return `${BASE_VALIDATORS[plan.base]}${checks.join("")}`;
}

// String lengths count Unicode code points through the generated counter: a JavaScript length counts UTF-16
// units. The uuid layout is a regex, since a library's own uuid check may also test the version digits.
function scalarCheck(check: ScalarCheck, base: ScalarBase, context: YupRenderContext): string {
  switch (check.rule) {
    case "format":
      return check.format === "uuid"
        ? namedTest(check.rule, check.message, `/${UUID_LAYOUT}/.test(value)`)
        : namedTest(check.rule, check.message, `${context.wireCheck(IS_DATE_TIME)}(value)`);
    case "minLength":
      return namedTest(
        check.rule,
        check.message,
        `${context.wireCheck(CODE_POINT_LENGTH)}(value) >= ${check.limit}`,
      );
    case "maxLength":
      return namedTest(
        check.rule,
        check.message,
        `${context.wireCheck(CODE_POINT_LENGTH)}(value) <= ${check.limit}`,
      );
    case "pattern":
      return namedTest(
        check.rule,
        check.message,
        `new RegExp(${JSON.stringify(check.normalized)}, "u").test(value)`,
      );
    case "minimum":
      return numericTest(
        base,
        check.rule,
        `Expected at least ${check.literal}.`,
        `value >= ${check.literal}`,
      );
    case "maximum":
      return numericTest(
        base,
        check.rule,
        `Expected at most ${check.literal}.`,
        `value <= ${check.literal}`,
      );
    case "exclusiveMinimum":
      return numericTest(
        base,
        check.rule,
        `Expected more than ${check.literal}.`,
        `value > ${check.literal}`,
      );
    case "exclusiveMaximum":
      return numericTest(
        base,
        check.rule,
        `Expected less than ${check.literal}.`,
        `value < ${check.literal}`,
      );
    case "multipleOf":
      return numericTest(
        base,
        check.rule,
        `Expected a multiple of ${check.literal}.`,
        `value % ${check.literal} === 0`,
      );
  }
}

function numericTest(
  base: ScalarBase,
  rule: string,
  message: string,
  predicateOnValue: string,
): string {
  const skip = NUMERIC_RULE_SKIPS[base];

  return namedTest(
    rule,
    message,
    skip === undefined ? predicateOnValue : `${skip} || ${predicateOnValue}`,
  );
}

// A check always carries its contract rule as its name, which a server boundary renders; every check of the
// generated validators goes through here so none can omit it. An absent value is the presence check's business.
function namedTest(rule: string, message: string, predicateOnValue: string): string {
  return `.test({ name: ${JSON.stringify(rule)}, message: ${JSON.stringify(message)}, test: (value) => value === undefined || ${predicateOnValue} })`;
}
