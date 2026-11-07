import {
  below,
  type IrLocation,
  propertyKey,
  refuseNotGeneratedYet,
  requireName,
  schemaLocation,
} from "@seampact/codegen-core";
import type { Enum, ObjectSchema, Property } from "@seampact/spec/ir";
import { isKnownVariant } from "@seampact/spec/ir";
import { type TypeContext, typeExpression } from "./type-expression.js";

// The source of the schemas module: one type per enum and one per schema, used for every direction the schema
// has (no slice form depends on the direction).
export function schemasModuleSource(context: TypeContext): string {
  const enumDeclarations = Object.entries(context.ir.enums).map(([enumId, declaration]) =>
    enumDeclaration(enumId, declaration, context),
  );

  const schemaDeclarations = Object.entries(context.ir.schemas).map(([schemaId, schema]) => {
    const location = schemaLocation(schemaId);

    // The layout refuses an unknown schema kind before any module is written.
    if (!isKnownVariant("Schema", schema)) return "";

    if (schema.kind !== "object") {
      context.refusals.push(
        refuseNotGeneratedYet(
          `schema.${schema.kind}`,
          `The ${schema.kind} schema '${schemaId}'`,
          location,
        ),
      );

      return "";
    }

    return objectDeclaration(schemaId, schema, context);
  });

  return [...enumDeclarations, ...schemaDeclarations].join("\n\n");
}

function enumDeclaration(enumId: string, declaration: Enum, context: TypeContext): string {
  const location = below({ member: "" }, "enums", enumId);

  if (declaration.codeNames !== undefined) {
    context.refusals.push(
      refuseNotGeneratedYet(
        "enum.codeNames",
        "An enum value's code name",
        below(location, "codeNames"),
      ),
    );
  }

  if (declaration.fallback !== undefined) {
    context.refusals.push(
      refuseNotGeneratedYet(
        "enum.fallback",
        "An open enum's fallback",
        below(location, "fallback"),
      ),
    );
  }

  const values = declaration.values.map((value) => JSON.stringify(value));
  const typeName = requireName(context.layout.enumTypeNames, enumId);

  return `export type ${typeName} = ${values.length === 0 ? "never" : values.join(" | ")};`;
}

function objectDeclaration(schemaId: string, schema: ObjectSchema, context: TypeContext): string {
  const location = schemaLocation(schemaId);
  const members = schema.properties.map((property, index) =>
    propertyMember(property, below(location, "properties", index), context),
  );
  const typeName = requireName(context.layout.schemaTypeNames, schemaId);

  return `export interface ${typeName} {\n${members.join("\n")}\n}`;
}

function propertyMember(property: Property, location: IrLocation, context: TypeContext): string {
  refusePropertyForms(property, location, context);

  const marker = property.optional ? "?" : "";
  const type = typeExpression(property.type, below(location, "type"), context);

  return `${propertyKey(property.name)}${marker}: ${type};`;
}

// The property members that change the type and that the slice does not use. `restrictedTo` on an optional
// property needs nothing here: the boundary rejects or strips the field.
function refusePropertyForms(property: Property, location: IrLocation, context: TypeContext): void {
  // An opaque value is typed `unknown`, which holds null already.
  if (property.nullable && property.type.kind !== "opaque") {
    context.refusals.push(
      refuseNotGeneratedYet("type.nullable", "A nullable property", below(location, "nullable")),
    );
  }

  if (property.default !== undefined) {
    context.refusals.push(
      refuseNotGeneratedYet("property.default", "A property default", below(location, "default")),
    );
  }

  if (property.codeName !== undefined) {
    context.refusals.push(
      refuseNotGeneratedYet(
        "property.codeName",
        "A property's code name",
        below(location, "codeName"),
      ),
    );
  }

  if (property.restrictedTo !== undefined && !property.optional) {
    context.refusals.push(
      refuseNotGeneratedYet(
        "property.restrictedTo.required",
        "A restricted property that is not optional",
        below(location, "restrictedTo"),
      ),
    );
  }
}
