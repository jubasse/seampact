import {
  type ContractIR,
  isKnownVariant,
  type ObjectSchema,
  type Property,
} from "@seampact/spec/ir";
import type { SchemaDirection } from "../descriptors.js";
import { below, type IrLocation, schemaLocation } from "../ir-location.js";
import { refuseNotGeneratedYet } from "../located-refusals.js";
import { requireName } from "../planned-names.js";
import type { Refusal } from "../refusal.js";
import type { ValidatorsLayout } from "./layout.js";
import {
  type FieldPlan,
  type ObjectPlan,
  type PlanContext,
  planTypeUse,
  referencedSchemas,
  type UnknownKeys,
} from "./type-plan.js";

// The validator of one object schema in one direction.
export interface SchemaPlan {
  readonly schemaId: string;
  readonly exportName: string;
  readonly object: ObjectPlan;
}

// The schemas of one direction by id, for a renderer that writes a reference inline.
export type SchemasById = ReadonlyMap<string, SchemaPlan>;

interface PlannedSchema {
  readonly plan: SchemaPlan;
  readonly dependencies: ReadonlySet<string>;
}

// An input refuses unknown keys and reports every issue (ADR 0003 section 4), an output strips them.
const UNKNOWN_KEYS_BY_DIRECTION: Readonly<Record<SchemaDirection, UnknownKeys>> = {
  input: "refuse",
  output: "strip",
};

// The validators of the schemas used in one direction, each after the schemas it references.
export function planSchemaModule(
  direction: SchemaDirection,
  ir: ContractIR,
  layout: ValidatorsLayout,
  refusals: Refusal[],
): SchemaPlan[] {
  const context: PlanContext = { ir, layout, refusals, direction };

  const planned = Object.entries(ir.schemas).flatMap(([schemaId, schema]): PlannedSchema[] => {
    if (!requireName(layout.schemaDirections, schemaId).includes(direction)) return [];

    // The layout refuses an unknown schema kind before any module is planned.
    if (!isKnownVariant("Schema", schema)) return [];

    if (schema.kind !== "object") {
      refusals.push(
        refuseNotGeneratedYet(
          `schema.${schema.kind}`,
          `The ${schema.kind} schema '${schemaId}'`,
          schemaLocation(schemaId),
        ),
      );

      return [];
    }

    return [objectSchemaPlan(schemaId, schema, context)];
  });

  return dependencyOrder(planned, refusals);
}

function objectSchemaPlan(
  schemaId: string,
  schema: ObjectSchema,
  context: PlanContext,
): PlannedSchema {
  const location = schemaLocation(schemaId);
  const fields = schema.properties.map((property, index) =>
    propertyField(property, below(location, "properties", index), context),
  );
  const dependencies = new Set(fields.flatMap((field) => referencedSchemas(field.type)));

  return {
    plan: {
      schemaId,
      exportName: requireName(context.layout.schemaExportNames, schemaId),
      object: { unknownKeys: UNKNOWN_KEYS_BY_DIRECTION[context.direction], fields },
    },
    dependencies,
  };
}

function propertyField(property: Property, location: IrLocation, context: PlanContext): FieldPlan {
  refusePropertyForms(property, location, context.refusals);

  // A nullable opaque property moves its `nullable` back onto the type use it holds for (ADR 0003 section 2).
  const typeUse =
    property.nullable && property.type.kind === "opaque"
      ? { ...property.type, nullable: true }
      : property.type;

  return {
    key: property.name,
    type: planTypeUse(typeUse, below(location, "type"), context),
    optional: property.optional,
  };
}

// The property members that change the validator and that the slice does not use. `restrictedTo` on an optional
// property needs nothing here: the boundary rejects or strips the field.
function refusePropertyForms(property: Property, location: IrLocation, refusals: Refusal[]): void {
  if (property.nullable && property.type.kind !== "opaque") {
    refusals.push(
      refuseNotGeneratedYet("type.nullable", "A nullable property", below(location, "nullable")),
    );
  }

  if (property.default !== undefined) {
    refusals.push(
      refuseNotGeneratedYet("property.default", "A property default", below(location, "default")),
    );
  }

  if (property.codeName !== undefined) {
    refusals.push(
      refuseNotGeneratedYet(
        "property.codeName",
        "A property's code name",
        below(location, "codeName"),
      ),
    );
  }

  if (property.restrictedTo !== undefined && !property.optional) {
    refusals.push(
      refuseNotGeneratedYet(
        "property.restrictedTo.required",
        "A restricted property that is not optional",
        below(location, "restrictedTo"),
      ),
    );
  }
}

// The plans with each one after those it references: a generated `const` cannot be read before it is declared.
// A cycle needs getters and is refused by name.
function dependencyOrder(planned: readonly PlannedSchema[], refusals: Refusal[]): SchemaPlan[] {
  const byId = new Map(planned.map((schema) => [schema.plan.schemaId, schema]));
  const ordered: SchemaPlan[] = [];
  const done = new Set<string>();
  const inProgress = new Set<string>();

  function visit(schema: PlannedSchema): void {
    const { schemaId } = schema.plan;

    if (done.has(schemaId)) return;

    if (inProgress.has(schemaId)) {
      refusals.push(
        refuseNotGeneratedYet(
          "schema.recursive",
          `The schema '${schemaId}', which references itself through its properties,`,
          schemaLocation(schemaId),
        ),
      );

      return;
    }

    inProgress.add(schemaId);

    for (const dependency of schema.dependencies) {
      const referenced = byId.get(dependency);

      if (referenced !== undefined) visit(referenced);
    }

    inProgress.delete(schemaId);
    done.add(schemaId);
    ordered.push(schema.plan);
  }

  planned.forEach(visit);

  return ordered;
}
