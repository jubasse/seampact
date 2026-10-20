import { type GeneratedFile, type Refusal, relativeModuleSpecifier } from "@seampact/codegen-core";
import type { OwnValidators } from "@seampact/codegen-core/node-server";
import {
  indexFile,
  type ModuleSource,
  moduleContents,
  modulePath,
  OPERATION_INPUT_MODULE,
  planValidators,
  SCHEMA_MODULES,
  validatorsDescriptor,
  WIRE_CHECKS_MODULE,
  WIRE_CHECKS_SOURCE,
  type WireCheck,
} from "@seampact/codegen-core/validators";
import type { ContractIR } from "@seampact/spec/ir";
import { AJV_STANDARD_SCHEMA, AJV_SUPPORT_MODULE, AJV_SUPPORT_SOURCE } from "./ajv-support.js";
import { objectSchema, operationInputSchema, type SchemasById } from "./json-schema.js";

// The Ajv validators of one api, written under the boundary's `validators/` directory when the entry gives no
// `validators` link: the schemas of each direction, one input validator per operation, the shared adapter and the
// generated wire checks. Every refusal of the shared plan applies (A47).
export function ajvOwnValidators(ir: ContractIR, refusals: Refusal[]): OwnValidators | undefined {
  const planned = planValidators(ir);

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
        declaration(schema.exportName, objectSchema(schema.object, inputSchemas)),
      ),
    },
    {
      module: SCHEMA_MODULES.output,
      declarations: plan.schemaModules.output.map((schema) =>
        declaration(schema.exportName, objectSchema(schema.object, outputSchemas)),
      ),
    },
    {
      module: OPERATION_INPUT_MODULE,
      declarations: plan.operationInputs.map((operation) =>
        declaration(operation.exportName, operationInputSchema(operation, inputSchemas)),
      ),
    },
  ];

  const files: GeneratedFile[] = modules.flatMap(({ module, declarations }) => {
    const source: ModuleSource = { declarations, wireChecks: new Set<WireCheck>(), namespaces: [] };
    const contents = moduleContents(module, source, supportImport(module));

    return contents === undefined ? [] : [{ path: modulePath(module), contents }];
  });

  files.push(
    { path: modulePath(AJV_SUPPORT_MODULE), contents: AJV_SUPPORT_SOURCE },
    { path: modulePath(WIRE_CHECKS_MODULE), contents: WIRE_CHECKS_SOURCE },
  );

  return {
    files: [...files, ...indexFile(files)],
    descriptor: validatorsDescriptor(ir, plan.layout, "standard-schema"),
  };
}

function declaration(exportName: string, schema: object): string {
  return `export const ${exportName} = ${AJV_STANDARD_SCHEMA}(${JSON.stringify(schema)});`;
}

function supportImport(module: string): string {
  const specifier = relativeModuleSpecifier(modulePath(module), AJV_SUPPORT_MODULE);

  return `import { ${AJV_STANDARD_SCHEMA} } from "${specifier}";`;
}
