import {
  type ObjectPlan,
  type OperationInputPlan,
  type ScalarCheck,
  type ScalarPlan,
  type SchemaPlan,
  type TypePlan,
  UUID_LAYOUT,
} from "@seampact/codegen-core/validators";

// The shape of each planned validator as plain data, which the generated `vine-support` module turns into a VineJS
// schema. A referenced schema is written inline, which the plan allows since a recursive schema is refused. The
// shape is the plan's own data: a scalar keeps its checks, so no rule is restated here; a `uuid` check carries the
// layout it tests.

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
  | (Extract<ScalarCheck, { rule: "format" }> & { readonly layout: string });

export interface ShapeField {
  readonly key: string;
  readonly optional: boolean;
  readonly type: Shape;
}

// The schemas of one direction by id, to write a reference inline.
export type SchemasById = ReadonlyMap<string, SchemaPlan>;

export function typeShape(plan: TypePlan, schemas: SchemasById): Shape {
  switch (plan.kind) {
    case "refused":
      throw new Error(
        "codegen-adonis: a refused plan reached the VineJS renderer; generate returns the plan's refusals instead.",
      );
    case "unknown":
      return plan;
    case "schema":
      return objectShape(requireSchema(schemas, plan.schemaId).object, schemas);
    case "enum":
      return { kind: "enum", values: plan.values, open: plan.openMembers };
    case "scalar":
      return { kind: "scalar", base: plan.base, checks: plan.checks.map(shapeCheck) };
    case "array":
      return {
        kind: "array",
        items: typeShape(plan.items, schemas),
        ...(plan.minItems === undefined ? {} : { minItems: plan.minItems }),
        ...(plan.maxItems === undefined ? {} : { maxItems: plan.maxItems }),
      };
  }
}

function shapeCheck(check: ScalarCheck): ShapeCheck {
  return check.rule === "format" && check.format === "uuid"
    ? { ...check, layout: UUID_LAYOUT }
    : check;
}

export function objectShape(plan: ObjectPlan, schemas: SchemasById): Shape {
  return {
    kind: "object",
    unknownKeys: plan.unknownKeys,
    fields: plan.fields.map((field) => ({
      key: field.key,
      optional: field.optional,
      type: typeShape(field.type, schemas),
    })),
  };
}

// The request object of one operation: `{ path, query, headers, body }`, each present when the operation declares it.
export function operationInputShape(plan: OperationInputPlan, schemas: SchemasById): Shape {
  const members: [string, Shape][] = [];

  if (plan.path !== undefined) members.push(["path", objectShape(plan.path, schemas)]);

  members.push(["query", objectShape(plan.query, schemas)]);

  if (plan.headers !== undefined) members.push(["headers", objectShape(plan.headers, schemas)]);

  if (plan.body !== undefined) members.push(["body", bodyShape(plan.body, schemas)]);

  return {
    kind: "object",
    unknownKeys: "strip",
    fields: members.map(([key, type]) => ({ key, optional: false, type })),
  };
}

// The proof fields extend the schema's object and keep its strictness.
function bodyShape(body: NonNullable<OperationInputPlan["body"]>, schemas: SchemasById): Shape {
  if (body.proofFields.length === 0) return typeShape(body.type, schemas);

  if (body.type.kind !== "schema") {
    throw new Error("codegen-adonis: proof fields beside a body that is not an object schema.");
  }

  const { object } = requireSchema(schemas, body.type.schemaId);

  return objectShape({ ...object, fields: [...object.fields, ...body.proofFields] }, schemas);
}

function requireSchema(schemas: SchemasById, schemaId: string): SchemaPlan {
  const schema = schemas.get(schemaId);

  if (schema === undefined) {
    throw new Error(`codegen-adonis: the plan has no validator for the schema '${schemaId}'.`);
  }

  return schema;
}
