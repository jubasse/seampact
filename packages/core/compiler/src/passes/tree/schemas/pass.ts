import type { IrWriter } from "@seampact/spec/ir";
import {
  type PassPart,
  pipelineTreeNodes,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import { treeNodesOperationNames } from "../nodes/index.js";
import { treeSchemasCodeParamsDeclarations, treeSchemasCompileCodeParams } from "./code-params.js";
import { TreeSchemasCompiler } from "./compile.js";
import { treeSchemasCoreReservations } from "./core.js";
import { treeSchemasRefuseOutputUnknownKeys, treeSchemasWriteDirections } from "./directions.js";
import { treeSchemasCompileEnums } from "./enums.js";
import { treeSchemasCheckExtensionValues, treeSchemasCompileExtensionKeys } from "./extensions.js";
import { TreeSchemasExampleChecker, treeSchemasCheckWrittenExamples } from "./example-check.js";
import {
  treeSchemasCompileBatchInputs,
  treeSchemasCompileVersionProperties,
} from "./operations.js";
import { treeSchemasCompileDeclarations, treeSchemasCompileRoutes } from "./positions.js";
import { treeSchemasFormProofRoutes, treeSchemasQueryWires } from "./query-wire.js";
import { TreeSchemasReporter } from "./raw.js";
import { treeSchemasCopyRelayDeclarations } from "./relays.js";

// The tree.schemas half (ADR 0006 sections 2 and 3): it seeds the core schemas, compiles every schema and enum of
// the api into `schemas`, `scalars` and `enums`, and returns the schema service every later half receives.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).

/** What the run compiled that the service answers from. */
export interface TreeSchemasServiceState {
  uses: ReadonlyMap<string, IrWriter.TypeUse>;
  queryWires: ReadonlyMap<string, IrWriter.QueryWire>;
  schemas: ReadonlyMap<string, IrWriter.Schema>;
  enums: readonly IrWriter.Enum[];
}

const copiedMap = <Value>(entries: ReadonlyMap<string, Value>): Map<string, Value> =>
  new Map([...entries].map(([key, value]) => [key, structuredClone(value)]));

/**
 * The schema service over the type uses, query wires, schemas and enums the run compiled: each answer a new copy,
 * the run's state unreachable. An output answer holds no `unknownKeys`, which acts on input uses only.
 */
export function treeSchemasService(state: TreeSchemasServiceState): TreeSchemaService {
  const answers = copiedMap(state.uses);
  const wires = copiedMap(state.queryWires);
  const checker = new TreeSchemasExampleChecker(
    copiedMap(state.schemas),
    new Map(state.enums.map((declared) => [declared.id, structuredClone(declared)])),
  );

  return {
    typeUse: (pointer, direction) => {
      const use = answers.get(pointer);

      if (use === undefined) return undefined;
      const answer = structuredClone(use);

      if (direction === "output" && answer.kind === "ref") delete answer.unknownKeys;

      return answer;
    },
    queryWire: (pointer) => {
      const wire = wires.get(pointer);

      return wire === undefined ? undefined : structuredClone(wire);
    },
    checkExample: (value, use) => checker.check(value, use),
    checkTextExample: (text, use) => checker.checkText(text, use),
  };
}

export const treeSchemasPass: PassPart<"tree.schemas"> = {
  pass: "tree",
  half: "tree.schemas",
  reads: [],
  writes: ["schemas", "scalars", "enums", "extensionKeys"],
  run: (draft, context) => {
    const reporter = new TreeSchemasReporter(context);
    const compiler = new TreeSchemasCompiler(context.raw.merged, reporter);

    const nodes = pipelineTreeNodes(context.raw);
    const codeParams = treeSchemasCodeParamsDeclarations(context.raw.merged, nodes);

    compiler.reserve(treeSchemasCoreReservations(codeParams));
    compiler.compileCatalogue();
    treeSchemasCompileDeclarations(compiler, context.raw.merged);
    treeSchemasCompileCodeParams(compiler, codeParams);
    const extensionKeys = treeSchemasCompileExtensionKeys(compiler, context.raw.merged);
    const operationNames = treeNodesOperationNames(context.raw, context.conventions);

    treeSchemasCompileRoutes(compiler, nodes, operationNames);
    treeSchemasCompileBatchInputs(compiler, nodes, operationNames, context.conventions);
    treeSchemasCompileVersionProperties(compiler, nodes, operationNames);
    compiler.finish();
    const declaredEnums = treeSchemasCompileEnums(context.raw.merged.enums, reporter);
    const relays = treeSchemasCopyRelayDeclarations(
      compiler,
      { enums: declaredEnums, extensionKeys },
      nodes,
      context,
      reporter,
    );

    for (const schema of relays.schemas) compiler.schemas.set(schema.id, schema);
    const enums = [...declaredEnums, ...relays.enums];
    const scalars = [...compiler.scalars.all(), ...relays.scalars];

    treeSchemasWriteDirections(compiler, enums, relays);
    treeSchemasRefuseOutputUnknownKeys(compiler, reporter);
    treeSchemasCheckExtensionValues(
      compiler,
      extensionKeys,
      { merged: context.raw.merged, nodes },
      reporter,
    );
    treeSchemasCheckWrittenExamples(
      compiler.exampleChecks,
      new TreeSchemasExampleChecker(
        compiler.schemas,
        new Map(enums.map((declared) => [declared.id, declared])),
      ),
      reporter,
    );

    for (const scalar of scalars) draft.scalars[scalar.id] = structuredClone(scalar);

    for (const [id, schema] of compiler.schemas) draft.schemas[id] = structuredClone(schema);

    for (const declared of enums) draft.enums[declared.id] = structuredClone(declared);

    for (const declared of [...extensionKeys, ...relays.extensionKeys])
      draft.extensionKeys[declared.id] = structuredClone(declared);

    return treeSchemasService({
      uses: compiler.uses,
      queryWires: treeSchemasQueryWires(
        compiler,
        context.conventions,
        treeSchemasFormProofRoutes(nodes, context.inherited, context.raw.merged.requirements),
      ),
      schemas: compiler.schemas,
      enums,
    });
  },
};
