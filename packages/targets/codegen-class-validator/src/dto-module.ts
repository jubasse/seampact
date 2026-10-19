import type { SchemaDirection } from "@seampact/codegen-core";
import type { ModuleSource, SchemaPlan, UnknownKeys } from "@seampact/codegen-core/validators";
import { type DtoRenderContext, fieldDeclaration } from "./dto-field.js";
import { CONSTRAINTS_IMPORT, dtoClassName } from "./layout.js";
import { LibraryImports } from "./library-imports.js";

// A module's declarations, what it imports beside the libraries, and the library import lines.
export interface DtoModuleSource {
  readonly source: ModuleSource;
  readonly libraryImports: string;
}

// The adapter of each direction refuses or strips unknown keys through its validation options, for every DTO.
const DIRECTION_POLICIES: Readonly<Record<SchemaDirection, UnknownKeys>> = {
  input: "refuse",
  output: "strip",
};

// The DTO classes of the schemas planned in one direction, in the plan's dependency order. Each is a plain class
// with no class-level constraint, so a subclass keeps every check (A45).
export function dtoModuleSource(
  direction: SchemaDirection,
  plans: readonly SchemaPlan[],
): DtoModuleSource {
  const imports = new LibraryImports();
  const context: DtoRenderContext = {
    referToDto: (_schemaId, exportName) => dtoClassName(exportName),
    validator: (name) => imports.validator(name),
    transformer: (name) => imports.transformer(name),
  };

  const declarations = plans.map((plan) => {
    if (plan.object.unknownKeys !== DIRECTION_POLICIES[direction]) {
      throw new Error(
        `codegen-class-validator: the ${direction} schema '${plan.schemaId}' is planned to ${plan.object.unknownKeys} unknown keys; its adapter can only ${DIRECTION_POLICIES[direction]} them.`,
      );
    }

    return classDeclaration(
      dtoClassName(plan.exportName),
      plan.object.fields.map((field) => fieldDeclaration(field, context)),
    );
  });

  return {
    source: { declarations, wireChecks: new Set(), namespaces: [CONSTRAINTS_IMPORT] },
    libraryImports: imports.importLines(),
  };
}

export function classDeclaration(
  className: string,
  members: readonly string[],
  extendsClass?: string,
): string {
  const heritage = extendsClass === undefined ? "" : ` extends ${extendsClass}`;

  return `export class ${className}${heritage} {\n${members.join("\n\n")}\n}`;
}
