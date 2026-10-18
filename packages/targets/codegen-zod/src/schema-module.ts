import {
  below,
  type IrLocation,
  propertyKey,
  type Refusal,
  refuseNotGeneratedYet,
  requireName,
  type SchemaDirection,
  schemaLocation,
} from "@seampact/codegen-core";
import {
  type ContractIR,
  isKnownVariant,
  type ObjectSchema,
  type Property,
} from "@seampact/spec/ir";
import type { ValidatorsLayout } from "./layout.js";
import type { ModuleSource, WireCheck } from "./module-source.js";
import { type ValidatorContext, validatorExpression } from "./validator-expression.js";

interface SchemaDeclaration {
  schemaId: string;
  source: string;
  dependencies: ReadonlySet<string>;
}

// The object constructor of each direction: an input refuses unknown keys and reports every issue (ADR 0003
// section 4), an output strips them. Neither is refined at object level, so `.extend`, `.pick`, `.omit` and
// `A.extend(B.shape)` work on every export (A45).
const OBJECT_CONSTRUCTORS: Readonly<Record<SchemaDirection, string>> = {
  input: "z.strictObject",
  output: "z.object",
};

// The validators of the schemas used in one direction, each declared after the schemas it references.
export function schemaModuleSource(
  direction: SchemaDirection,
  ir: ContractIR,
  layout: ValidatorsLayout,
  refusals: Refusal[],
): ModuleSource {
  const wireChecks = new Set<WireCheck>();

  const declarations = Object.entries(ir.schemas).flatMap(
    ([schemaId, schema]): SchemaDeclaration[] => {
      if (!requireName(layout.schemaDirections, schemaId).includes(direction)) return [];

      // The layout refuses an unknown schema kind before any module is written.
      if (!isKnownVariant("Schema", schema)) return [];

      const location = schemaLocation(schemaId);

      if (schema.kind !== "object") {
        refusals.push(
          refuseNotGeneratedYet(
            `schema.${schema.kind}`,
            `The ${schema.kind} schema '${schemaId}'`,
            location,
          ),
        );

        return [];
      }

      const dependencies = new Set<string>();
      const context: ValidatorContext = {
        ir,
        layout,
        refusals,
        direction,
        referToSchema(referencedId, exportName) {
          dependencies.add(referencedId);

          return exportName;
        },
        wireCheck(check) {
          wireChecks.add(check);

          return check;
        },
      };

      return [{ schemaId, source: objectDeclaration(schemaId, schema, context), dependencies }];
    },
  );

  const ordered = dependencyOrder(declarations, refusals);

  return {
    declarations: ordered.map((declaration) => declaration.source),
    wireChecks,
    namespaces: [],
  };
}

function objectDeclaration(
  schemaId: string,
  schema: ObjectSchema,
  context: ValidatorContext,
): string {
  const location = schemaLocation(schemaId);
  const members = schema.properties.map((property, index) =>
    propertyMember(property, below(location, "properties", index), context),
  );
  const exportName = requireName(context.layout.schemaExportNames, schemaId);

  return `export const ${exportName} = ${OBJECT_CONSTRUCTORS[context.direction]}({\n${members.join("\n")}\n});`;
}

function propertyMember(
  property: Property,
  location: IrLocation,
  context: ValidatorContext,
): string {
  refusePropertyForms(property, location, context.refusals);

  const validator = validatorExpression(property.type, below(location, "type"), context);

  return `${propertyKey(property.name)}: ${validator}${property.optional ? ".optional()" : ""},`;
}

// The property members that change the validator and that the slice does not use. `restrictedTo` on an optional
// property needs nothing here: the boundary rejects or strips the field.
function refusePropertyForms(property: Property, location: IrLocation, refusals: Refusal[]): void {
  if (property.nullable) {
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

// The declarations with each one after those it references: a `const` cannot be read before it is declared.
// A cycle needs getters and is refused by name.
function dependencyOrder(
  declarations: readonly SchemaDeclaration[],
  refusals: Refusal[],
): SchemaDeclaration[] {
  const byId = new Map(declarations.map((declaration) => [declaration.schemaId, declaration]));
  const ordered: SchemaDeclaration[] = [];
  const done = new Set<string>();
  const inProgress = new Set<string>();

  function visit(declaration: SchemaDeclaration): void {
    if (done.has(declaration.schemaId)) return;

    if (inProgress.has(declaration.schemaId)) {
      refusals.push(
        refuseNotGeneratedYet(
          "schema.recursive",
          `The schema '${declaration.schemaId}', which references itself through its properties,`,
          schemaLocation(declaration.schemaId),
        ),
      );

      return;
    }

    inProgress.add(declaration.schemaId);

    for (const dependency of declaration.dependencies) {
      const referenced = byId.get(dependency);

      if (referenced !== undefined) visit(referenced);
    }

    inProgress.delete(declaration.schemaId);
    done.add(declaration.schemaId);
    ordered.push(declaration);
  }

  declarations.forEach(visit);

  return ordered;
}
