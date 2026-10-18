import {
  below,
  declaredTypeIdentifier,
  ExportNames,
  operationLocation,
  type Refusal,
  type Refused,
  refuseUnknownValueAt,
  requireName,
  type TypesDescriptor,
  typeScriptIdentifier,
} from "@seampact/codegen-core";
import {
  type ContractIR,
  type EnumId,
  isKnownVariant,
  type OperationId,
  type SchemaId,
} from "@seampact/spec/ir";
import { deriveName } from "@seampact/spec/naming";

// The module paths of the generated files, without extension, relative to the output root.
export const SCHEMAS_MODULE = "schemas";
export const OPERATION_INPUT_MODULE = "operations/input";
export const OPERATION_OUTPUT_MODULE = "operations/output";
export const OPERATION_ERRORS_MODULE = "operations/errors";

export const MODULE_EXTENSION = ".ts";

export interface OperationTypeNames {
  input: string;
  output: string;
  errors: string;
}

// Every export name the target writes, computed once so that `describe` and `generate` cannot disagree.
export interface TypesLayout {
  schemaTypeNames: ReadonlyMap<SchemaId, string>;
  enumTypeNames: ReadonlyMap<EnumId, string>;
  operationTypeNames: ReadonlyMap<OperationId, OperationTypeNames>;
}

const KNOWN_DIRECTIONS: readonly string[] = ["input", "output"];

// Names each schema, enum and operation type through ADR 0007, and refuses two exports of one module that would
// take one name, or a schema direction this target does not know.
export function planTypesLayout(
  ir: ContractIR,
): { status: "planned"; layout: TypesLayout } | Refused {
  const refusals: Refusal[] = [];
  const schemaTypeNames = new Map<SchemaId, string>();
  const enumTypeNames = new Map<EnumId, string>();
  const operationTypeNames = new Map<OperationId, OperationTypeNames>();
  const schemasModuleNames = new ExportNames(SCHEMAS_MODULE);
  const operationModuleNames = new ExportNames("operations");

  for (const [enumId, declaration] of Object.entries(ir.enums)) {
    const location = below({ member: "" }, "enums", enumId, "name");
    const typeName = declaredTypeIdentifier(declaration.name, location, refusals);

    enumTypeNames.set(enumId, typeName);
    schemasModuleNames.claim(typeName, location, refusals);
  }

  for (const [schemaId, schema] of Object.entries(ir.schemas)) {
    const location = below({ member: "" }, "schemas", schemaId);

    if (!isKnownVariant("Schema", schema)) {
      refusals.push(refuseUnknownValueAt(below(location, "kind"), schema.kind));
      continue;
    }

    const typeName = declaredTypeIdentifier(schema.name, below(location, "name"), refusals);

    schemaTypeNames.set(schemaId, typeName);
    schemasModuleNames.claim(typeName, below(location, "name"), refusals);

    schema.directions.forEach((direction, index) => {
      if (!KNOWN_DIRECTIONS.includes(direction)) {
        refusals.push(refuseUnknownValueAt(below(location, "directions", index), direction));
      }
    });
  }

  ir.operations.forEach((operation, index) => {
    const location = below(operationLocation(index, operation.id), "name");
    const segments = operation.name.segments;
    const names: OperationTypeNames = {
      input: operationTypeIdentifier(segments, "input"),
      output: operationTypeIdentifier(segments, "output"),
      errors: operationTypeIdentifier(segments, "errors"),
    };

    operationTypeNames.set(operation.id, names);
    operationModuleNames.claim(names.input, location, refusals);
  });

  if (refusals.length > 0) return { status: "refused", refusals };

  return { status: "planned", layout: { schemaTypeNames, enumTypeNames, operationTypeNames } };
}

// The `types` descriptor: each schema's one type for every direction it has, and each operation's three types.
export function typesDescriptor(ir: ContractIR, layout: TypesLayout): TypesDescriptor {
  const schemas: TypesDescriptor["schemas"] = Object.fromEntries(
    Object.entries(ir.schemas).flatMap(([schemaId, schema]) => {
      // The layout refused an unknown schema kind, so `describe` never returns this descriptor with one.
      if (!isKnownVariant("Schema", schema)) return [];

      const exportRef = {
        module: SCHEMAS_MODULE,
        export: requireName(layout.schemaTypeNames, schemaId),
      };
      const directions = schema.directions.filter((direction) =>
        KNOWN_DIRECTIONS.includes(direction),
      );

      return [
        [
          schemaId,
          Object.fromEntries(directions.map((direction) => [direction, { ...exportRef }])),
        ],
      ];
    }),
  );

  const operations: TypesDescriptor["operations"] = Object.fromEntries(
    ir.operations.map((operation) => {
      const names = requireName(layout.operationTypeNames, operation.id);

      return [
        operation.id,
        {
          input: { module: OPERATION_INPUT_MODULE, export: names.input },
          output: { module: OPERATION_OUTPUT_MODULE, export: names.output },
          errors: { module: OPERATION_ERRORS_MODULE, export: names.errors },
        },
      ];
    }),
  );

  return { kind: "types", style: "typescript", schemas, operations };
}

function operationTypeIdentifier(
  segments: readonly string[],
  role: "input" | "output" | "errors",
): string {
  return typeScriptIdentifier(deriveName(segments, role));
}
