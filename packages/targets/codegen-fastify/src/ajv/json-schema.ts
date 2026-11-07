import type {
  ObjectPlan,
  OperationInputPlan,
  ScalarBase,
  ScalarCheck,
  ScalarPlan,
  SchemaPlan,
  SchemasById,
  TypePlan,
} from "@seampact/codegen-core/validators";
import { INTEGER_MULTIPLE_KEYWORD, MESSAGES_KEYWORD } from "./ajv-support.js";

// The JSON Schema 2020-12 (Ajv strict mode) of each planned validator. A referenced schema is written inline, which
// the plan allows since a recursive schema is refused; the generated schemas stay readable and need no `$ref`.

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [member: string]: JsonValue };

export type JsonObject = { readonly [member: string]: JsonValue };

const SAFE_INTEGER_LIMIT = Number.MAX_SAFE_INTEGER;

const JSON_TYPES: Readonly<Record<ScalarBase, string>> = {
  string: "string",
  integer: "integer",
  number: "number",
  boolean: "boolean",
};

export function typeSchema(plan: TypePlan, schemas: SchemasById): JsonValue {
  switch (plan.kind) {
    case "refused":
      throw new Error(
        "codegen-fastify: a refused plan reached the Ajv renderer; generate returns the plan's refusals instead.",
      );
    case "unknown":
      return plan.nullable ? {} : { not: { type: "null" } };
    case "schema":
      return objectSchema(requireSchema(schemas, plan.schemaId).object, schemas);
    case "enum":
      return plan.openMembers ? { type: "string" } : { enum: [...plan.values] };
    case "scalar":
      return scalarSchema(plan);
    case "array":
      return {
        type: "array",
        items: typeSchema(plan.items, schemas),
        ...(plan.minItems === undefined ? {} : { minItems: plan.minItems }),
        ...(plan.maxItems === undefined ? {} : { maxItems: plan.maxItems }),
      };
  }
}

// A `refuse` object names its unknown keys through `additionalProperties`; a `strip` object leaves it out and the
// adapter keeps its declared keys only.
export function objectSchema(plan: ObjectPlan, schemas: SchemasById): JsonObject {
  const properties = Object.fromEntries(
    plan.fields.map((field) => [field.key, typeSchema(field.type, schemas)]),
  );
  const required = plan.fields.filter((field) => !field.optional).map((field) => field.key);

  return {
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required }),
    ...(plan.unknownKeys === "refuse" ? { additionalProperties: false } : {}),
  };
}

// The request object of one operation: `{ path, query, headers, body }`, each present when the operation declares it.
export function operationInputSchema(plan: OperationInputPlan, schemas: SchemasById): JsonObject {
  const members: [string, JsonValue][] = [];

  if (plan.path !== undefined) members.push(["path", objectSchema(plan.path, schemas)]);

  members.push(["query", objectSchema(plan.query, schemas)]);

  if (plan.headers !== undefined) members.push(["headers", objectSchema(plan.headers, schemas)]);

  if (plan.body !== undefined) members.push(["body", bodySchema(plan.body, schemas)]);

  return {
    type: "object",
    properties: Object.fromEntries(members),
    required: members.map(([name]) => name),
  };
}

// The proof fields extend the schema's object and keep its strictness.
function bodySchema(
  body: NonNullable<OperationInputPlan["body"]>,
  schemas: SchemasById,
): JsonValue {
  if (body.proofFields.length === 0) return typeSchema(body.type, schemas);

  if (body.type.kind !== "schema") {
    throw new Error("codegen-fastify: proof fields beside a body that is not an object schema.");
  }

  const { object } = requireSchema(schemas, body.type.schemaId);

  return objectSchema({ ...object, fields: [...object.fields, ...body.proofFields] }, schemas);
}

function requireSchema(schemas: SchemasById, schemaId: string): SchemaPlan {
  const schema = schemas.get(schemaId);

  if (schema === undefined) {
    throw new Error(`codegen-fastify: the plan has no validator for the schema '${schemaId}'.`);
  }

  return schema;
}

function scalarSchema(plan: ScalarPlan): JsonObject {
  const checks = plan.base === "integer" ? withoutBounds(plan.checks) : plan.checks;
  const bounds = plan.base === "integer" ? safeIntegerBounds(plan.checks) : [];

  const messages = checkMessages(checks);

  return Object.fromEntries([
    ["type", JSON_TYPES[plan.base]],
    ...checks.map(scalarRule),
    ...bounds,
    ...(Object.keys(messages).length === 0 ? [] : [[MESSAGES_KEYWORD, messages]]),
  ]);
}

// The plan's message of each check that words one, by Ajv keyword, for the adapter to report.
function checkMessages(checks: readonly ScalarCheck[]): JsonObject {
  return Object.fromEntries(
    checks.flatMap((check) => ("message" in check ? [[scalarRule(check)[0], check.message]] : [])),
  );
}

function scalarRule(check: ScalarCheck): [string, JsonValue] {
  switch (check.rule) {
    case "format":
      return ["format", check.format];
    case "minLength":
    case "maxLength":
      return [check.rule, check.limit];
    case "pattern":
      return ["pattern", check.normalized];
    case "multipleOf":
      return [INTEGER_MULTIPLE_KEYWORD, { literal: check.literal, step: check.integerStep }];
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
      return [check.rule, Number(check.literal)];
  }
}

function withoutBounds(checks: readonly ScalarCheck[]): ScalarCheck[] {
  return checks.filter((check) => check.rule !== "minimum" && check.rule !== "maximum");
}

// A plain integer is in the safe range of ADR 0003, reported as `minimum` and `maximum`; a bound of the contract
// inside that range stands as written.
function safeIntegerBounds(checks: readonly ScalarCheck[]): [string, JsonValue][] {
  const declaredBound = (rule: "minimum" | "maximum"): number | undefined => {
    const check = checks.find((candidate) => candidate.rule === rule);

    return check !== undefined && "literal" in check ? Number(check.literal) : undefined;
  };

  return [
    ["minimum", Math.max(declaredBound("minimum") ?? -SAFE_INTEGER_LIMIT, -SAFE_INTEGER_LIMIT)],
    ["maximum", Math.min(declaredBound("maximum") ?? SAFE_INTEGER_LIMIT, SAFE_INTEGER_LIMIT)],
  ];
}
