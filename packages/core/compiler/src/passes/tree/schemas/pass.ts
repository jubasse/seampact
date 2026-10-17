import type { IrWriter } from "@seampact/spec/ir";
import {
  type PassPart,
  pipelineTreeNodes,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import { treeNodesOperationNames } from "../nodes/index.js";
import { TreeSchemasCompiler } from "./compile.js";
import { treeSchemasCoreReservations } from "./core.js";
import { treeSchemasCompileEnums } from "./enums.js";
import {
  treeSchemasCompileBatchInputs,
  treeSchemasCompileVersionProperties,
} from "./operations.js";
import { treeSchemasCompileDeclarations, treeSchemasCompileRoutes } from "./positions.js";
import { TreeSchemasReporter } from "./raw.js";

// The tree.schemas half (ADR 0006 sections 2 and 3): it seeds the core schemas, compiles every schema and enum of
// the api into `schemas`, `scalars` and `enums`, and returns the schema service every later half receives.
//
// Import pipeline values and types from `pipeline/seam.js` only, never from `pipeline/index.js`, the orchestrator
// or the registry: the registry imports this module, so any of those would close an import cycle (`seam.ts`).

/** The schema service over the type uses the run compiled: each answer a new copy, the run's state unreachable. */
export function treeSchemasService(uses: ReadonlyMap<string, IrWriter.TypeUse>): TreeSchemaService {
  const answers = new Map(uses);

  return {
    typeUse: (pointer) => {
      const use = answers.get(pointer);

      return use === undefined ? undefined : structuredClone(use);
    },
    queryWire: () => undefined,
    checkExample: () => [],
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

    compiler.reserve(treeSchemasCoreReservations(context.raw.merged));
    compiler.compileCatalogue();
    treeSchemasCompileDeclarations(compiler, context.raw.merged);
    const nodes = pipelineTreeNodes(context.raw);
    const operationNames = treeNodesOperationNames(context.raw, context.conventions);

    treeSchemasCompileRoutes(compiler, nodes, operationNames);
    treeSchemasCompileBatchInputs(compiler, nodes, operationNames, context.conventions);
    treeSchemasCompileVersionProperties(compiler, nodes, operationNames);
    compiler.finish();
    const enums = treeSchemasCompileEnums(context.raw.merged.enums, reporter);

    for (const scalar of compiler.scalars.all()) draft.scalars[scalar.id] = structuredClone(scalar);

    for (const [id, schema] of compiler.schemas) draft.schemas[id] = structuredClone(schema);

    for (const declared of enums) draft.enums[declared.id] = structuredClone(declared);

    return treeSchemasService(compiler.uses);
  },
};
