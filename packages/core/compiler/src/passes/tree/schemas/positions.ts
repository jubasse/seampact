import type { IrWriter } from "@seampact/spec/ir";
import { deriveName, type Name, segmentsOf, splitName, suffixWords } from "@seampact/spec/naming";
import type { TreeNode } from "../../../pipeline/seam.js";
import type { TreeNodesOperationName } from "../nodes/index.js";
import type { TreeSchemasCompiler, TreeSchemasPlace } from "./compile.js";
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
    const proofPointer = treeSchemasPointer(at, "proof", "schema");

    positionAt(compiler, treeSchemasMember(proof, "schema"), proofPointer);
    compiler.queryPositions.add(proofPointer);
  }

  for (const [code, error] of treeSchemasEntries(merged.errors))
    paramsAt(compiler, error, treeSchemasPointer("/errors", code), splitName(code));
}

// The name an inline schema at a route position is hoisted under: the operation's segments and the position's
// role (ADR 0007 section 3); a position outside an operation derives none.
type RouteRole = "input" | "output" | "query" | "headers" | "path";

const routeName = (operation: IrWriter.Name | undefined, role: RouteRole): Name | undefined =>
  operation === undefined ? undefined : deriveName(operation.segments, role);

const responseName = (operation: IrWriter.Name | undefined, status: string): Name | undefined =>
  operation === undefined ? undefined : deriveName(operation.segments, "response", Number(status));

// A fields map entry: an inline schema there is named as a property of the map's derived name.
const routeFieldsAt = (
  compiler: TreeSchemasCompiler,
  fields: TreeSchemasRaw | undefined,
  pointer: string,
  owner: Name | undefined,
): void => {
  if (typeof fields === "string") {
    positionAt(compiler, fields, pointer);

    return;
  }

  const words = owner === undefined ? undefined : [...owner.segments, ...suffixWords(owner)];

  for (const [key, schema] of treeSchemasEntries(fields)) {
    const wire = key.endsWith("?") ? key.slice(0, -1) : key;
    const own = splitName(wire);
    const name =
      words === undefined || own.length === 0
        ? undefined
        : deriveName([...words, ...own], "property");

    compiler.position(schema, {
      pointer: treeSchemasPointer(pointer, key),
      name,
      place: "position",
    });
  }
};

const FIELDS_MAPS = [
  ["id", undefined],
  ["pathParams", "path"],
  ["query", "query"],
  ["headers", "headers"],
] as const;

const OPERATION_KINDS: ReadonlySet<TreeNode["kind"]> = new Set(["route", "op"]);

/**
 * Compiles the route positions of the tree (ADR 0002 sections 6 and 7), an inline schema hoisted under the name
 * its operation derives. A relay route writes none; neither does an operation `names` lacks, whose naming problem
 * tree.nodes reports.
 */
export function treeSchemasCompileRoutes(
  compiler: TreeSchemasCompiler,
  nodes: readonly TreeNode[],
  names: ReadonlyMap<string, TreeNodesOperationName>,
): void {
  for (const node of nodes) {
    const operation = names.get(node.pointer)?.name;

    if (node.kind === "relay" || (OPERATION_KINDS.has(node.kind) && operation === undefined))
      continue;
    const settings = node.settings;
    const at = (...segments: string[]) => treeSchemasPointer(node.pointer, ...segments);

    positionAt(compiler, settings.item, at("item"));

    if (settings.input !== undefined)
      compiler.position(settings.input, {
        pointer: at("input"),
        name: routeName(operation, "input"),
        place: "routeInput",
      });

    if (settings.output !== undefined)
      compiler.position(settings.output, {
        pointer: at("output"),
        name: routeName(operation, "output"),
        place: "position",
      });

    for (const [status, response] of treeSchemasEntries(settings.responses)) {
      const body = treeSchemasMember(response, "body");

      if (body !== undefined)
        compiler.position(body, {
          pointer: at("responses", status, "body"),
          name: responseName(operation, status),
          place: "position",
        });
      routeFieldsAt(
        compiler,
        treeSchemasMember(response, "headers"),
        at("responses", status, "headers"),
        undefined,
      );
    }

    for (const [key, role] of FIELDS_MAPS)
      routeFieldsAt(
        compiler,
        settings[key],
        at(key),
        role === undefined ? undefined : routeName(operation, role),
      );

    // A query field written as a schema name has its wire at the schema's properties.
    for (const [key] of treeSchemasEntries(settings.query))
      compiler.queryPositions.add(at("query", key));
  }
}
