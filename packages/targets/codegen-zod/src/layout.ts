import type {
  Refusal,
  Refused,
  SchemaDirection,
  ValidatorsDescriptor,
} from "@seampact/codegen-core";
import {
  type ContractIR,
  isKnownVariant,
  type Name,
  type OperationId,
  type SchemaId,
} from "@seampact/spec/ir";
import { deriveName, identifier, isRole } from "@seampact/spec/naming";
import { below, type IrLocation, operationLocation } from "./ir-location.js";
import { refuseUnknownValueAt } from "./refusals.js";

// The module paths of the generated files, without extension, relative to the output root.
export const SCHEMA_MODULES: Readonly<Record<SchemaDirection, string>> = {
  input: "schemas/input",
  output: "schemas/output",
};
export const OPERATION_INPUT_MODULE = "operations/input";
export const CODE_POINTS_MODULE = "code-points";

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
    const exportName = `${typeIdentifier(deriveName(operation.name.segments, "input"))}${VALIDATOR_SUFFIX}`;

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

// A planned name; the layout holds every id of the IR it was planned from.
export function requireName<Key, Value>(names: ReadonlyMap<Key, Value>, key: Key): Value {
  const name = names.get(key);

  if (name === undefined) throw new Error(`no planned name for ${String(key)}`);

  return name;
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
  const role = name.role;

  if (!isRole(role)) {
    refusals.push(refuseUnknownValueAt(below(location, "role"), role));

    return "";
  }

  return `${typeIdentifier(deriveName(name.segments, role, name.status))}${VALIDATOR_SUFFIX}`;
}

function typeIdentifier(name: ReturnType<typeof deriveName>): string {
  const typeName = identifier(name, "typescript");

  // Every type role has a TypeScript identifier (ADR 0007 section 4).
  if (typeName === undefined) throw new Error(`the role ${name.role} has no TypeScript identifier`);

  return typeName;
}

// The names one module exports; a second export of one name is refused, naming both members.
class ExportNames {
  private readonly claimed = new Map<string, string>();

  constructor(private readonly module: string) {}

  claim(exportName: string, location: IrLocation, refusals: Refusal[]): void {
    const first = this.claimed.get(exportName);

    if (first === undefined) {
      this.claimed.set(exportName, location.member);

      return;
    }

    refusals.push({
      code: "export.name.duplicate",
      message: `The name '${exportName}' of ${location.member} is already the name of ${first} in the module '${this.module}'.`,
      fix: "Rename one of the two in the contract so that their names differ.",
      member: location.member,
      ...(location.operation === undefined ? {} : { operation: location.operation }),
    });
  }
}
