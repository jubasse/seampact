import { splitName } from "@seampact/spec/naming";
import { pipelineCanonical, type TreeNode } from "../../../pipeline/seam.js";
import type { TreeSchemasCompiler } from "./compile.js";
import {
  type TreeSchemasRaw,
  type TreeSchemasRawObject,
  treeSchemasEntries,
  treeSchemasMember,
  treeSchemasPointer,
} from "./raw.js";

// The params of the error codes declared in the `errors` catalogue or on any tree node, a relay included (grammar
// section 11, ADR 0006 section 6). One code has one definition, so its params are hoisted once as `<Code>Params`
// at its first declaration, the catalogue's before the nodes'. A later declaration with equal params takes the
// same use; one with different params is left to the derive pass, which refuses the code declared twice with
// different definitions, naming both locations.

/** One declaration of a code's params, at `pointer` (`.../errors/<code>/params`). */
export interface TreeSchemasCodeParams {
  pointer: string;
  params: TreeSchemasRaw;
}

/** The params declarations of each code, in declaration order: the catalogue's first, then the tree's. */
export type TreeSchemasCodeParamsDeclarations = ReadonlyMap<
  string,
  readonly TreeSchemasCodeParams[]
>;

function addDeclarations(
  declarations: Map<string, TreeSchemasCodeParams[]>,
  errors: TreeSchemasRaw | undefined,
  base: string,
): void {
  for (const [code, error] of treeSchemasEntries(errors)) {
    const params = treeSchemasMember(error, "params");

    if (params === undefined) continue;
    const declared = declarations.get(code) ?? [];

    declared.push({ pointer: treeSchemasPointer(base, code, "params"), params });
    declarations.set(code, declared);
  }
}

/** Collects every declaration of a code's params in the merged catalogue and on the tree nodes. */
export function treeSchemasCodeParamsDeclarations(
  merged: TreeSchemasRawObject,
  nodes: readonly TreeNode[],
): TreeSchemasCodeParamsDeclarations {
  const declarations = new Map<string, TreeSchemasCodeParams[]>();

  addDeclarations(declarations, merged.errors, "/errors");

  for (const node of nodes)
    addDeclarations(declarations, node.settings.errors, treeSchemasPointer(node.pointer, "errors"));

  return declarations;
}

/** Hoists each code's params once and gives every declaration with equal params the same use; error params are output. */
export function treeSchemasCompileCodeParams(
  compiler: TreeSchemasCompiler,
  declarations: TreeSchemasCodeParamsDeclarations,
): void {
  for (const [code, [first, ...others]] of declarations) {
    const segments = splitName(code);

    if (first === undefined || segments.length === 0) continue;
    compiler.fields(first.params, first.pointer, { segments, role: "params" }, ["output"]);
    const written = pipelineCanonical(first.params);

    for (const other of others) {
      if (pipelineCanonical(other.params) === written)
        compiler.shareUse(first.pointer, other.pointer, ["output"]);
    }
  }
}
