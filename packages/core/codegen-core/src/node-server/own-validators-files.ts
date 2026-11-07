import type { ContractIR } from "@seampact/spec/ir";
import { relativeModuleSpecifier } from "../import-specifier.js";
import type { Refusal, Refused } from "../refusal.js";
import type { GeneratedFile } from "../target.js";
import { indexFile } from "../validators/index-file.js";
import {
  OPERATION_INPUT_MODULE,
  SCHEMA_MODULES,
  validatorsDescriptor,
  WIRE_CHECKS_MODULE,
} from "../validators/layout.js";
import { type ModuleSource, moduleContents, modulePath } from "../validators/module-source.js";
import type { OperationInputPlan } from "../validators/operation-input-plan.js";
import type { SchemasById } from "../validators/schema-plan.js";
import type { ObjectPlan } from "../validators/type-plan.js";
import type { ValidatorsPlan } from "../validators/validators-plan.js";
import { WIRE_CHECKS_SOURCE, type WireCheck } from "../validators/wire-checks.js";
import type { OwnValidators } from "./boundary-files.js";

// A server target's own validator library: its support module, which exports the adapter that wraps each rendered
// validator into a Standard Schema, and the rendering of an object and of an operation input as plain data.
export interface OwnValidatorsLibrary<Rendered> {
  readonly supportModule: string;
  readonly supportSource: string;
  readonly adapterExport: string;
  objectValidator(object: ObjectPlan, schemas: SchemasById): Rendered;
  operationInputValidator(operation: OperationInputPlan, schemas: SchemasById): Rendered;
}

// The validators a server target writes in its own library, under the boundary's `validators/` directory when the
// entry gives no `validators` link: the schemas of each direction, one input validator per operation, the support
// module and the generated wire checks. Every refusal of the plan applies (A47): they are pushed and nothing returns.
export function ownValidatorsFiles<Rendered>(
  ir: ContractIR,
  planned: { status: "planned"; plan: ValidatorsPlan } | Refused,
  library: OwnValidatorsLibrary<Rendered>,
  refusals: Refusal[],
): OwnValidators | undefined {
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
  const declaration = (exportName: string, rendered: Rendered): string =>
    `export const ${exportName} = ${library.adapterExport}(${JSON.stringify(rendered)});`;

  const modules: { module: string; declarations: string[] }[] = [
    {
      module: SCHEMA_MODULES.input,
      declarations: plan.schemaModules.input.map((schema) =>
        declaration(schema.exportName, library.objectValidator(schema.object, inputSchemas)),
      ),
    },
    {
      module: SCHEMA_MODULES.output,
      declarations: plan.schemaModules.output.map((schema) =>
        declaration(schema.exportName, library.objectValidator(schema.object, outputSchemas)),
      ),
    },
    {
      module: OPERATION_INPUT_MODULE,
      declarations: plan.operationInputs.map((operation) =>
        declaration(operation.exportName, library.operationInputValidator(operation, inputSchemas)),
      ),
    },
  ];

  const files: GeneratedFile[] = modules.flatMap(({ module, declarations }) => {
    const source: ModuleSource = { declarations, wireChecks: new Set<WireCheck>(), namespaces: [] };
    const specifier = relativeModuleSpecifier(modulePath(module), library.supportModule);
    const contents = moduleContents(
      module,
      source,
      `import { ${library.adapterExport} } from "${specifier}";`,
    );

    return contents === undefined ? [] : [{ path: modulePath(module), contents }];
  });

  files.push(
    { path: modulePath(library.supportModule), contents: library.supportSource },
    { path: modulePath(WIRE_CHECKS_MODULE), contents: WIRE_CHECKS_SOURCE },
  );

  return {
    files: [...files, ...indexFile(files)],
    descriptor: validatorsDescriptor(ir, plan.layout, "standard-schema"),
  };
}
