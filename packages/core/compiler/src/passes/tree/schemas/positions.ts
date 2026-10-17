import { segmentsOf, splitName } from "@seampact/spec/naming";
import type { TreeNode } from "../../../pipeline/seam.js";
import {
  type TreeSchemasCompiler,
  type TreeSchemasPlace,
  treeSchemasNeedsHoist,
} from "./compile.js";
import {
  type TreeSchemasRaw,
  type TreeSchemasRawObject,
  treeSchemasEntries,
  treeSchemasIsObject,
  treeSchemasMember,
  treeSchemasPointer,
} from "./raw.js";

// The schema positions outside the `schemas` catalogue (ADR 0003, introduction): the declaration positions of the
// catalogues (principals, header schemas, scope and subject ids, params, rule proofs) and the route positions of
// the tree (ADR 0002 sections 6 and 7).

const positionAt = (
  compiler: TreeSchemasCompiler,
  value: TreeSchemasRaw | undefined,
  pointer: string,
  place: TreeSchemasPlace = "position",
): void => {
  if (value !== undefined) compiler.position(value, { pointer, name: undefined, place });
};

// The params of a right, rule or error: a fields map hoisted as `<owner>Params` (ADR 0007 section 3).
const paramsAt = (
  compiler: TreeSchemasCompiler,
  declaration: TreeSchemasRaw,
  pointer: string,
  segments: readonly string[],
): void => {
  const params = treeSchemasMember(declaration, "params");

  if (params === undefined || segments.length === 0) return;
  compiler.fields(params, treeSchemasPointer(pointer, "params"), {
    segments: [...segments],
    role: "params",
  });
};

/** Compiles the schemas written in the catalogues besides `schemas`. */
export function treeSchemasCompileDeclarations(
  compiler: TreeSchemasCompiler,
  merged: TreeSchemasRawObject,
): void {
  for (const [id, identity] of treeSchemasEntries(merged.identities)) {
    const at = treeSchemasPointer("/identities", id);
    const principal = treeSchemasMember(identity, "principal");
    const variants = treeSchemasMember(principal, "variants");

    if (treeSchemasIsObject(variants)) {
      for (const [variant, schema] of treeSchemasEntries(variants))
        positionAt(compiler, schema, treeSchemasPointer(at, "principal", "variants", variant));
    } else {
      positionAt(compiler, principal, treeSchemasPointer(at, "principal"));
    }

    for (const [header, use] of treeSchemasEntries(treeSchemasMember(identity, "headers")))
      positionAt(
        compiler,
        treeSchemasMember(use, "schema"),
        treeSchemasPointer(at, "headers", header, "schema"),
      );
  }

  for (const [id, header] of treeSchemasEntries(merged.headers))
    positionAt(
      compiler,
      treeSchemasMember(header, "schema"),
      treeSchemasPointer("/headers", id, "schema"),
    );

  for (const [id, scope] of treeSchemasEntries(merged.scopes))
    positionAt(compiler, treeSchemasMember(scope, "id"), treeSchemasPointer("/scopes", id, "id"));

  for (const [id, right] of treeSchemasEntries(merged.rights)) {
    const at = treeSchemasPointer("/rights", id);
    const codeName = treeSchemasMember(right, "codeName");
    // A right without segments and without codeName is access.rights' error; its params are named once it has one.
    const segments = segmentsOf(id, "right", typeof codeName === "string" ? { codeName } : {});

    paramsAt(compiler, right, at, segments.ok ? segments.segments : []);
    const subject = treeSchemasMember(right, "subject");

    positionAt(compiler, treeSchemasMember(subject, "id"), treeSchemasPointer(at, "subject", "id"));
  }

  for (const [id, rule] of treeSchemasEntries(merged.rules)) {
    const at = treeSchemasPointer("/rules", id);

    paramsAt(compiler, rule, at, splitName(id));
    const proof = treeSchemasMember(rule, "proof");

    positionAt(
      compiler,
      treeSchemasMember(proof, "schema"),
      treeSchemasPointer(at, "proof", "schema"),
    );
  }

  for (const [code, error] of treeSchemasEntries(merged.errors))
    paramsAt(compiler, error, treeSchemasPointer("/errors", code), splitName(code));
}

// A route position whose schema needs a hoist is named from its operation, which a later step of this half
// compiles; until then the service answers undefined there.
const routePositionAt = (
  compiler: TreeSchemasCompiler,
  value: TreeSchemasRaw | undefined,
  pointer: string,
  place: TreeSchemasPlace = "position",
): void => {
  if (!treeSchemasNeedsHoist(value)) positionAt(compiler, value, pointer, place);
};

const routeFieldsAt = (
  compiler: TreeSchemasCompiler,
  fields: TreeSchemasRaw | undefined,
  pointer: string,
): void => {
  if (typeof fields === "string") {
    routePositionAt(compiler, fields, pointer);

    return;
  }

  for (const [name, schema] of treeSchemasEntries(fields))
    routePositionAt(compiler, schema, treeSchemasPointer(pointer, name));
};

const FIELDS_MAPS = ["id", "pathParams", "query", "headers"] as const;

/** Compiles the route positions of the tree (ADR 0002 sections 6 and 7); a relay route writes none. */
export function treeSchemasCompileRoutes(
  compiler: TreeSchemasCompiler,
  nodes: readonly TreeNode[],
): void {
  for (const node of nodes) {
    if (node.kind === "relay") continue;
    const settings = node.settings;
    const at = (...segments: string[]) => treeSchemasPointer(node.pointer, ...segments);

    routePositionAt(compiler, settings.item, at("item"));
    routePositionAt(compiler, settings.input, at("input"), "routeInput");
    routePositionAt(compiler, settings.output, at("output"));

    for (const [status, response] of treeSchemasEntries(settings.responses)) {
      routePositionAt(
        compiler,
        treeSchemasMember(response, "body"),
        at("responses", status, "body"),
      );
      routeFieldsAt(
        compiler,
        treeSchemasMember(response, "headers"),
        at("responses", status, "headers"),
      );
    }

    for (const key of FIELDS_MAPS) routeFieldsAt(compiler, settings[key], at(key));
  }
}
