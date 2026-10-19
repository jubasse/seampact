import { propertyKey } from "@seampact/codegen-core";
import type {
  FieldPlan,
  ScalarBase,
  ScalarCheck,
  ScalarPlan,
  TypePlan,
} from "@seampact/codegen-core/validators";
import { CONSTRAINTS_IMPORT } from "./layout.js";

// How a module refers to a DTO class and records the library names its decorators use, so it imports them.
export interface DtoRenderContext {
  referToDto(schemaId: string, validatorExportName: string): string;
  validator(name: string): string;
  transformer(name: string): string;
}

const CONTRACT = CONSTRAINTS_IMPORT.name;

const BASE_DECORATORS: Readonly<Record<ScalarBase, { name: string; options: string }>> = {
  string: { name: "IsString", options: "" },
  integer: { name: "IsInt", options: "" },
  number: { name: "IsNumber", options: "{ allowNaN: false, allowInfinity: false }" },
  boolean: { name: "IsBoolean", options: "" },
};

const BASE_TYPES: Readonly<Record<ScalarBase, string>> = {
  string: "string",
  integer: "number",
  number: "number",
  boolean: "boolean",
};

// A decorated class field. An optional field skips its checks when absent; `null` is still checked.
export function fieldDeclaration(field: FieldPlan, context: DtoRenderContext): string {
  const presence = field.optional ? [`@${CONTRACT}.ValidateIfPresent()`] : [];
  const decorators = [...presence, ...typeDecorators(field.type, context)];
  const declaration = `${propertyKey(field.key)}${field.optional ? "?" : "!"}: ${typeText(field.type, context)};`;

  return [...decorators, declaration].join("\n");
}

// A field holding a nested DTO class: an object, validated through the class `@Type` names.
export function nestedDtoDeclaration(
  key: string,
  className: string,
  context: DtoRenderContext,
): string {
  return [...nestedDtoDecorators(className, context), `${propertyKey(key)}!: ${className};`].join(
    "\n",
  );
}

function typeDecorators(plan: TypePlan, context: DtoRenderContext): string[] {
  switch (plan.kind) {
    case "refused":
      throw refusedPlanReached();
    case "unknown":
      return [`@${context.validator("Allow")}()`];
    case "schema":
      return nestedDtoDecorators(context.referToDto(plan.schemaId, plan.exportName), context);
    case "enum":
      return [`@${context.validator("IsIn")}(${JSON.stringify(plan.values)})`];
    case "scalar":
      return scalarDecorators(plan, context);
    case "array":
      return [
        `@${context.validator("IsArray")}()`,
        ...(plan.minItems === undefined
          ? []
          : [`@${context.validator("ArrayMinSize")}(${plan.minItems})`]),
        ...(plan.maxItems === undefined
          ? []
          : [`@${context.validator("ArrayMaxSize")}(${plan.maxItems})`]),
        ...itemDecorators(plan.items, context),
      ];
  }
}

function nestedDtoDecorators(className: string, context: DtoRenderContext): string[] {
  return [
    `@${context.validator("IsObject")}()`,
    `@${context.validator("ValidateNested")}()`,
    `@${context.transformer("Type")}(() => ${className})`,
  ];
}

// The items of a list: an object item through its DTO class, a scalar or enum item through the item checks,
// which report each failing item at its index.
function itemDecorators(items: TypePlan, context: DtoRenderContext): string[] {
  switch (items.kind) {
    case "refused":
      throw refusedPlanReached();
    case "unknown":
      return [];
    case "schema":
      return [
        `@${CONTRACT}.ArrayItems([${CONTRACT}.objectTypeCheck()])`,
        `@${context.validator("ValidateNested")}({ each: true })`,
        `@${context.transformer("Type")}(() => ${context.referToDto(items.schemaId, items.exportName)})`,
      ];
    case "enum":
      return [`@${CONTRACT}.ArrayItems([${CONTRACT}.enumCheck(${JSON.stringify(items.values)})])`];
    case "scalar": {
      const checks = [
        `${CONTRACT}.scalarTypeCheck(${JSON.stringify(items.base)})`,
        ...items.checks.map(itemCheck),
      ];

      return [`@${CONTRACT}.ArrayItems([${checks.join(", ")}])`];
    }

    case "array":
      throw new Error(
        "codegen-class-validator: a list of lists reached the renderer; generate refuses it by name first.",
      );
  }
}

function scalarDecorators(plan: ScalarPlan, context: DtoRenderContext): string[] {
  const base = BASE_DECORATORS[plan.base];

  return [
    `@${context.validator(base.name)}(${base.options})`,
    ...plan.checks.map((check) => scalarCheckDecorator(check, context)),
  ];
}

// `Matches` is exact for a pattern in `u` mode; the other rules are the contract constraints.
function scalarCheckDecorator(check: ScalarCheck, context: DtoRenderContext): string {
  switch (check.rule) {
    case "format":
      return `@${CONTRACT}.Format(${JSON.stringify(check.format)}, ${JSON.stringify(check.message)})`;
    case "minLength":
      return `@${CONTRACT}.MinLength(${check.limit}, ${JSON.stringify(check.message)})`;
    case "maxLength":
      return `@${CONTRACT}.MaxLength(${check.limit}, ${JSON.stringify(check.message)})`;
    case "pattern":
      return `@${context.validator("Matches")}(new RegExp(${JSON.stringify(check.normalized)}, "u"), { message: ${JSON.stringify(check.message)} })`;
    case "minimum":
      return `@${CONTRACT}.Minimum(${check.literal})`;
    case "maximum":
      return `@${CONTRACT}.Maximum(${check.literal})`;
  }
}

function itemCheck(check: ScalarCheck): string {
  switch (check.rule) {
    case "format":
      return `${CONTRACT}.formatCheck(${JSON.stringify(check.format)}, ${JSON.stringify(check.message)})`;
    case "minLength":
      return `${CONTRACT}.minLengthCheck(${check.limit}, ${JSON.stringify(check.message)})`;
    case "maxLength":
      return `${CONTRACT}.maxLengthCheck(${check.limit}, ${JSON.stringify(check.message)})`;
    case "pattern":
      return `${CONTRACT}.patternCheck(${JSON.stringify(check.normalized)}, ${JSON.stringify(check.message)})`;
    case "minimum":
      return `${CONTRACT}.minimumCheck(${check.literal})`;
    case "maximum":
      return `${CONTRACT}.maximumCheck(${check.literal})`;
  }
}

function typeText(plan: TypePlan, context: DtoRenderContext): string {
  switch (plan.kind) {
    case "refused":
      throw refusedPlanReached();
    case "unknown":
      return "unknown";
    case "schema":
      return context.referToDto(plan.schemaId, plan.exportName);
    case "enum":
      return plan.values.length === 0
        ? "never"
        : plan.values.map((value) => JSON.stringify(value)).join(" | ");
    case "scalar":
      return BASE_TYPES[plan.base];
    case "array":
      return `Array<${typeText(plan.items, context)}>`;
  }
}

function refusedPlanReached(): Error {
  return new Error(
    "codegen-class-validator: a refused plan reached the renderer; generate returns the plan's refusals instead.",
  );
}
