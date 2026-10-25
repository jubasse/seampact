import type { RulesMode } from "@seampact/codegen-core/validators";
import {
  type ObjectPlan,
  type OperationInputPlan,
  type ScalarCheck,
  type ScalarPlan,
  type SchemaPlan,
  type SchemasById,
  type TypePlan,
  UUID_LAYOUT,
} from "@seampact/codegen-core/validators";

// The shape of each planned validator as plain data, which the generated `vine-support` module turns into a VineJS
// schema. A referenced schema is written inline, which the plan allows since a recursive schema is refused. The
// shape is the plan's own data: a scalar keeps its checks, so no rule is restated here; a `uuid` check carries the
// layout it tests. Under `rules: native` a check VineJS has a rule for is marked `native`, and the support module
// builds it with that rule instead of the contract's check.

export type Shape =
  | { readonly kind: "unknown"; readonly nullable: boolean }
  | {
      readonly kind: "object";
      readonly unknownKeys: ObjectPlan["unknownKeys"];
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
      readonly base: ScalarPlan["base"];
      readonly checks: readonly ShapeCheck[];
    };

export type ShapeCheck =
  | ScalarCheck
  | (Extract<ScalarCheck, { rule: "format" }> & { readonly layout: string })
  | (ScalarCheck & { readonly native: true });

// The contract rules VineJS has a rule of its own for: `minLength`, `maxLength`, `regex`, `uuid`, `min` and `max`.
// `date-time` has no string rule, exclusive bounds and `multipleOf` none at all: their contract checks stay.
const VINE_NATIVE_RULES: ReadonlySet<ScalarCheck["rule"]> = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
]);

export interface ShapeField {
  readonly key: string;
  readonly optional: boolean;
  readonly type: Shape;
}

export function typeShape(plan: TypePlan, schemas: SchemasById, rules: RulesMode): Shape {
  switch (plan.kind) {
    case "refused":
      throw new Error(
        "codegen-adonis: a refused plan reached the VineJS renderer; generate returns the plan's refusals instead.",
      );
    case "unknown":
      return plan;
    case "schema":
      return objectShape(requireSchema(schemas, plan.schemaId).object, schemas, rules);
    case "enum":
      return { kind: "enum", values: plan.values, open: plan.openMembers };
    case "scalar":
      return {
        kind: "scalar",
        base: plan.base,
        checks: plan.checks.map((check) => shapeCheck(check, rules)),
      };
    case "array":
      return {
        kind: "array",
        items: typeShape(plan.items, schemas, rules),
        ...(plan.minItems === undefined ? {} : { minItems: plan.minItems }),
        ...(plan.maxItems === undefined ? {} : { maxItems: plan.maxItems }),
      };
  }
}

function shapeCheck(check: ScalarCheck, rules: RulesMode): ShapeCheck {
  if (rules === "native" && hasVineRule(check)) return { ...check, native: true };

  return check.rule === "format" && check.format === "uuid"
    ? { ...check, layout: UUID_LAYOUT }
    : check;
}

function hasVineRule(check: ScalarCheck): boolean {
  return check.rule === "format" ? check.format === "uuid" : VINE_NATIVE_RULES.has(check.rule);
}

export function objectShape(plan: ObjectPlan, schemas: SchemasById, rules: RulesMode): Shape {
  return {
    kind: "object",
    unknownKeys: plan.unknownKeys,
    fields: plan.fields.map((field) => ({
      key: field.key,
      optional: field.optional,
      type: typeShape(field.type, schemas, rules),
    })),
  };
}

// The request object of one operation: `{ path, query, headers, body }`, each present when the operation declares it.
export function operationInputShape(
  plan: OperationInputPlan,
  schemas: SchemasById,
  rules: RulesMode,
): Shape {
  const members: [string, Shape][] = [];

  if (plan.path !== undefined) members.push(["path", objectShape(plan.path, schemas, rules)]);

  members.push(["query", objectShape(plan.query, schemas, rules)]);

  if (plan.headers !== undefined)
    members.push(["headers", objectShape(plan.headers, schemas, rules)]);

  if (plan.body !== undefined) members.push(["body", bodyShape(plan.body, schemas, rules)]);

  return {
    kind: "object",
    unknownKeys: "strip",
    fields: members.map(([key, type]) => ({ key, optional: false, type })),
  };
}

// The proof fields extend the schema's object and keep its strictness.
function bodyShape(
  body: NonNullable<OperationInputPlan["body"]>,
  schemas: SchemasById,
  rules: RulesMode,
): Shape {
  if (body.proofFields.length === 0) return typeShape(body.type, schemas, rules);

  if (body.type.kind !== "schema") {
    throw new Error("codegen-adonis: proof fields beside a body that is not an object schema.");
  }

  const { object } = requireSchema(schemas, body.type.schemaId);

  return objectShape(
    { ...object, fields: [...object.fields, ...body.proofFields] },
    schemas,
    rules,
  );
}

function requireSchema(schemas: SchemasById, schemaId: string): SchemaPlan {
  const schema = schemas.get(schemaId);

  if (schema === undefined) {
    throw new Error(`codegen-adonis: the plan has no validator for the schema '${schemaId}'.`);
  }

  return schema;
}
