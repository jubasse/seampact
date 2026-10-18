import {
  below,
  declaredTypeIdentifier,
  ExportNames,
  type IrLocation,
  operationLocation,
  type Refusal,
  type Refused,
  refuseUnknownValueAt,
  requireName,
  type SchemaDirection,
  typeScriptIdentifier,
  type ValidatorsDescriptor,
} from "@seampact/codegen-core";
import {
  type ContractIR,
  isKnownVariant,
  type Name,
  type OperationId,
  type SchemaId,
} from "@seampact/spec/ir";
import { deriveName } from "@seampact/spec/naming";

// The module paths of the generated files, without extension, relative to the output root.
export const SCHEMA_MODULES: Readonly<Record<SchemaDirection, string>> = {
  input: "schemas/input",
  output: "schemas/output",
};
export const OPERATION_INPUT_MODULE = "operations/input";
export const WIRE_CHECKS_MODULE = "wire-checks";
export const INDEX_MODULE = "index";

// The two schema modules export the same `<TypeName>Schema` names, so the index groups each under its direction;
// the operation input validators stay flat (`GetTaskInputSchema` cannot meet a direction namespace).
export const SCHEMA_NAMESPACES: Readonly<Record<SchemaDirection, string>> = {
  input: "inputSchemas",
  output: "outputSchemas",
};

export const MODULE_EXTENSION = ".ts";

// The suffix of every validator export, beside the type name of ADR 0007 (`TaskSchema` validates `Task`).
const VALIDATOR_SUFFIX = "Schema";

const SCHEMA_DIRECTIONS: readonly SchemaDirection[] = ["input", "output"];

// Every export name the target writes, computed once so that `describe` and `generate` cannot disagree.
export interface ValidatorsLayout {
  // The validator export of each schema, the same name in each direction module the schema has.
  schemaExportNames: ReadonlyMap<SchemaId, string>;
  schemaDirections: ReadonlyMap<SchemaId, readonly SchemaDirection[]>;
  operationExportNames: ReadonlyMap<OperationId, string>;
}

// Names each schema and operation validator through ADR 0007, and refuses two exports of one module that would
// take one name, or a schema kind or direction this target does not know.
export function planValidatorsLayout(
  ir: ContractIR,
): { status: "planned"; layout: ValidatorsLayout } | Refused {
  const refusals: Refusal[] = [];
  const schemaExportNames = new Map<SchemaId, string>();
  const schemaDirections = new Map<SchemaId, SchemaDirection[]>();
  const operationExportNames = new Map<OperationId, string>();
  const schemaModuleNames = new ExportNames("schemas");
  const operationModuleNames = new ExportNames(OPERATION_INPUT_MODULE);

  for (const [schemaId, schema] of Object.entries(ir.schemas)) {
    const location = below({ member: "" }, "schemas", schemaId);

    if (!isKnownVariant("Schema", schema)) {
      refusals.push(refuseUnknownValueAt(below(location, "kind"), schema.kind));
      continue;
    }

    const exportName = validatorName(schema.name, below(location, "name"), refusals);

    schemaExportNames.set(schemaId, exportName);
    schemaModuleNames.claim(exportName, below(location, "name"), refusals);
    schemaDirections.set(schemaId, knownDirections(schema.directions, location, refusals));
  }

  ir.operations.forEach((operation, index) => {
    const location = below(operationLocation(index, operation.id), "name");
    const exportName = `${typeScriptIdentifier(deriveName(operation.name.segments, "input"))}${VALIDATOR_SUFFIX}`;

    operationExportNames.set(operation.id, exportName);
    operationModuleNames.claim(exportName, location, refusals);
  });

  if (refusals.length > 0) return { status: "refused", refusals };

  return {
    status: "planned",
    layout: { schemaExportNames, schemaDirections, operationExportNames },
  };
}

// The `validators` descriptor: each schema's validator in every direction it has, and each operation's input
// validator.
export function validatorsDescriptor(
  ir: ContractIR,
  layout: ValidatorsLayout,
): ValidatorsDescriptor {
  const schemas: ValidatorsDescriptor["schemas"] = Object.fromEntries(
    [...layout.schemaExportNames].map(([schemaId, exportName]) => {
      const directions = requireName(layout.schemaDirections, schemaId);
      const exports = directions.map((direction) => [
        direction,
        { module: SCHEMA_MODULES[direction], export: exportName },
      ]);

      return [schemaId, Object.fromEntries(exports)];
    }),
  );

  const operations: ValidatorsDescriptor["operations"] = Object.fromEntries(
    ir.operations.map((operation) => [
      operation.id,
      {
        input: {
          module: OPERATION_INPUT_MODULE,
          export: requireName(layout.operationExportNames, operation.id),
        },
      },
    ]),
  );

  return { kind: "validators", style: "standard-schema", schemas, operations };
}

function knownDirections(
  directions: readonly string[],
  location: IrLocation,
  refusals: Refusal[],
): SchemaDirection[] {
  directions.forEach((direction, index) => {
    if (!SCHEMA_DIRECTIONS.some((known) => known === direction)) {
      refusals.push(refuseUnknownValueAt(below(location, "directions", index), direction));
    }
  });

  return SCHEMA_DIRECTIONS.filter((direction) => directions.includes(direction));
}

function validatorName(name: Name, location: IrLocation, refusals: Refusal[]): string {
  return `${declaredTypeIdentifier(name, location, refusals)}${VALIDATOR_SUFFIX}`;
}
