import { type GeneratedFile, type Refusal, relativeModuleSpecifier } from "@seampact/codegen-core";
import type { OwnValidators } from "@seampact/codegen-core/node-server";
import {
  indexFile,
  type ModuleSource,
  moduleContents,
  modulePath,
  OPERATION_INPUT_MODULE,
  SCHEMA_MODULES,
  validatorsDescriptor,
  WIRE_CHECKS_MODULE,
  WIRE_CHECKS_SOURCE,
  type WireCheck,
} from "@seampact/codegen-core/validators";
import type { ContractIR } from "@seampact/spec/ir";
import { planVineValidators } from "./path-keys.js";
import { objectShape, operationInputShape, type SchemasById, type Shape } from "./shape.js";
import { VINE_STANDARD_SCHEMA, VINE_SUPPORT_MODULE, VINE_SUPPORT_SOURCE } from "./vine-support.js";

// The VineJS validators of one api, written under the boundary's `validators/` directory when the entry gives no
// `validators` link: the shape of each direction's schemas, one input validator per operation, the shared adapter and
// the generated wire checks. Every refusal of the shared plan applies (A47).
export function vineOwnValidators(ir: ContractIR, refusals: Refusal[]): OwnValidators | undefined {
  const planned = planVineValidators(ir);

  if (planned.status === "refused") {
    refusals.push(...planned.refusals);

    return undefined;
  }

  const { plan } = planned;
  const inputSchemas: SchemasById = new Map(
    plan.schemaModules.input.map((schema) => [schema.schemaId, schema]),
  );
  const outputSchemas: SchemasById = new Map(
    plan.schemaModules.output.map((schema) => [schema.schemaId, schema]),
  );

  const modules: { module: string; declarations: string[] }[] = [
    {
      module: SCHEMA_MODULES.input,
      declarations: plan.schemaModules.input.map((schema) =>
        declaration(schema.exportName, objectShape(schema.object, inputSchemas)),
      ),
    },
    {
      module: SCHEMA_MODULES.output,
      declarations: plan.schemaModules.output.map((schema) =>
        declaration(schema.exportName, objectShape(schema.object, outputSchemas)),
      ),
    },
    {
      module: OPERATION_INPUT_MODULE,
      declarations: plan.operationInputs.map((operation) =>
        declaration(operation.exportName, operationInputShape(operation, inputSchemas)),
      ),
    },
  ];

  const files: GeneratedFile[] = modules.flatMap(({ module, declarations }) => {
    const source: ModuleSource = { declarations, wireChecks: new Set<WireCheck>(), namespaces: [] };
    const contents = moduleContents(module, source, supportImport(module));

    return contents === undefined ? [] : [{ path: modulePath(module), contents }];
  });

  files.push(
    { path: modulePath(VINE_SUPPORT_MODULE), contents: VINE_SUPPORT_SOURCE },
    { path: modulePath(WIRE_CHECKS_MODULE), contents: WIRE_CHECKS_SOURCE },
  );

  return {
    files: [...files, ...indexFile(files)],
    descriptor: validatorsDescriptor(ir, plan.layout, "standard-schema"),
  };
}

function declaration(exportName: string, shape: Shape): string {
  return `export const ${exportName} = ${VINE_STANDARD_SCHEMA}(${JSON.stringify(shape)});`;
}

function supportImport(module: string): string {
  const specifier = relativeModuleSpecifier(modulePath(module), VINE_SUPPORT_MODULE);

  return `import { ${VINE_STANDARD_SCHEMA} } from "${specifier}";`;
}
