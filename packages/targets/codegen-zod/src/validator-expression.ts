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
  type UnknownKeys,
  UUID_LAYOUT,
  type WireCheck,
} from "@seampact/codegen-core/validators";

// How a module refers to a schema validator and to a generated check, so it can import what it uses.
export interface ZodRenderContext {
  referToSchema(schemaId: string, exportName: string): string;
  wireCheck(check: WireCheck): string;
}

// The object constructor of each unknown keys policy. Neither is refined at object level, so `.extend`, `.pick`,
// `.omit` and `A.extend(B.shape)` work on every export (A45).
const OBJECT_CONSTRUCTORS: Readonly<Record<UnknownKeys, string>> = {
  refuse: "z.strictObject",
  strip: "z.object",
};

const BASE_VALIDATORS: Readonly<Record<ScalarBase, string>> = {
  string: "z.string()",
  integer: "z.int()",
  number: "z.number()",
  boolean: "z.boolean()",
};

// The zod validator of a planned type use.
export function validatorExpression(plan: TypePlan, context: ZodRenderContext): string {
  switch (plan.kind) {
    case "refused":
      throw new Error(
        "codegen-zod: a refused plan reached the renderer; generate returns the plan's refusals instead.",
      );
    case "unknown":
      return `z.unknown()${nonNullCheck()}`;
    case "schema":
      return context.referToSchema(plan.schemaId, plan.exportName);
    case "enum":
      if (plan.openMembers) return "z.string()";

      return plan.values.length === 0 ? "z.never()" : `z.enum(${JSON.stringify(plan.values)})`;
    case "scalar":
      return scalarValidator(plan, context);
    case "array": {
      const items = validatorExpression(plan.items, context);
      const minimum = plan.minItems === undefined ? "" : `.min(${plan.minItems})`;
      const maximum = plan.maxItems === undefined ? "" : `.max(${plan.maxItems})`;

      return `z.array(${items})${minimum}${maximum}`;
    }
  }
}

// `{ key: validator, ... }` inside the constructor of the object's unknown keys policy.
export function objectExpression(plan: ObjectPlan, context: ZodRenderContext): string {
  return `${OBJECT_CONSTRUCTORS[plan.unknownKeys]}({\n${fieldMembers(plan.fields, context)}\n})`;
}

export function fieldMembers(fields: readonly FieldPlan[], context: ZodRenderContext): string {
  return fields
    .map(
      (field) =>
        `${propertyKey(field.key)}: ${validatorExpression(field.type, context)}${field.optional ? ".optional()" : ""},`,
    )
    .join("\n");
}

function scalarValidator(plan: ScalarPlan, context: ZodRenderContext): string {
  const checks = plan.checks.map((check) => scalarCheck(check, context));

  return `${BASE_VALIDATORS[plan.base]}${checks.join("")}`;
}

// String lengths count Unicode code points through the generated counter: zod's own `min` and `max` count UTF-16
// units. zod's `uuid()` also checks the RFC 9562 version and variant digits, so the layout is a regex.
function scalarCheck(check: ScalarCheck, context: ZodRenderContext): string {
  switch (check.rule) {
    case "format":
      return check.format === "uuid"
        ? `.regex(/${UUID_LAYOUT}/, { error: ${JSON.stringify(check.message)} })`
        : customCheck(context.wireCheck(IS_DATE_TIME), check.message, check.rule);
    case "minLength":
      return customCheck(
        `(value) => ${context.wireCheck(CODE_POINT_LENGTH)}(value) >= ${check.limit}`,
        check.message,
        check.rule,
      );
    case "maxLength":
      return customCheck(
        `(value) => ${context.wireCheck(CODE_POINT_LENGTH)}(value) <= ${check.limit}`,
        check.message,
        check.rule,
      );
    case "pattern":
      return customCheck(
        `(value) => new RegExp(${JSON.stringify(check.normalized)}, "u").test(value)`,
        check.message,
        check.rule,
      );
    case "minimum":
      return `.gte(${check.literal})`;
    case "maximum":
      return `.lte(${check.literal})`;
    case "exclusiveMinimum":
      return `.gt(${check.literal})`;
    case "exclusiveMaximum":
      return `.lt(${check.literal})`;
    case "multipleOf":
      return `.multipleOf(${check.literal})`;
  }
}

// An opaque value takes any JSON value but `null`: the IR holds no nullable opaque yet (ADR 0003 section 2).
function nonNullCheck(): string {
  return customCheck("(value) => value !== null", "Expected a value, not null.", "type");
}

// A custom zod check always names its contract rule in `params.rule`, which a server boundary renders; every
// `.refine` of the generated validators goes through here so none can omit it.
function customCheck(predicate: string, message: string, rule: string): string {
  return `.refine(${predicate}, { error: ${JSON.stringify(message)}, params: { rule: ${JSON.stringify(rule)} } })`;
}
