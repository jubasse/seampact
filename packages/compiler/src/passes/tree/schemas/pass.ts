import type { IrWriter } from "@seampact/spec/ir";
import {
  type PassPart,
  pipelineTreeNodes,
  type TreeSchemaService,
} from "../../../pipeline/seam.js";
import { TreeSchemasCompiler } from "./compile.js";
import { treeSchemasCompileDeclarations, treeSchemasCompileRoutes } from "./positions.js";
import { TreeSchemasReporter } from "./raw.js";

// The tree.schemas half (ADR 0006 sections 2 and 3): it compiles every schema of the api into `schemas` and
// `scalars`, and returns the schema service every later half receives.
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
    const compiler = new TreeSchemasCompiler(context.raw.merged, new TreeSchemasReporter(context));
    compiler.compileCatalogue();
    treeSchemasCompileDeclarations(compiler, context.raw.merged);
    treeSchemasCompileRoutes(compiler, pipelineTreeNodes(context.raw));
    compiler.finish();

    for (const scalar of compiler.scalars.all()) draft.scalars[scalar.id] = structuredClone(scalar);
    for (const [id, schema] of compiler.schemas) draft.schemas[id] = structuredClone(schema);
    return treeSchemasService(compiler.uses);
  },
};
