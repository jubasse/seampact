import type { IrWriter } from "@seampact/spec/ir";
import { deriveName, type Name, segmentsOf, splitName, suffixWords } from "@seampact/spec/naming";
import type { TreeNode } from "../../../pipeline/seam.js";
import type { TreeNodesOperationName } from "../nodes/index.js";
import type { TreeSchemasCompiler } from "./compile.js";
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

// The directions of ADR 0003 section 4, by position kind.
const INPUT: readonly IrWriter.Direction[] = ["input"];
const OUTPUT: readonly IrWriter.Direction[] = ["output"];
const BOTH: readonly IrWriter.Direction[] = ["input", "output"];

const positionAt = (
  compiler: TreeSchemasCompiler,
  value: TreeSchemasRaw | undefined,
  pointer: string,
  directions: readonly IrWriter.Direction[],
): void => {
  if (value !== undefined)
    compiler.position(value, { pointer, name: undefined, place: "position" }, directions);
};

// A header declaration's schema is used as its `in` says; a version token (no `in`) is read and answered.
const headerDirections = (
  declaration: TreeSchemasRaw | undefined,
): readonly IrWriter.Direction[] => {
  const where = treeSchemasMember(declaration, "in");

  if (where === "request") return INPUT;

  return where === "response" ? OUTPUT : BOTH;
};

// The params of a right, rule or error: a fields map hoisted as `<owner>Params` (ADR 0007 section 3).
const paramsAt = (
  compiler: TreeSchemasCompiler,
  declaration: TreeSchemasRaw,
  pointer: string,
  segments: readonly string[],
  directions: readonly IrWriter.Direction[],
): void => {
  const params = treeSchemasMember(declaration, "params");

  if (params === undefined || segments.length === 0) return;
  compiler.fields(
    params,
    treeSchemasPointer(pointer, "params"),
    { segments: [...segments], role: "params" },
    directions,
  );
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
        positionAt(
          compiler,
          schema,
          treeSchemasPointer(at, "principal", "variants", variant),
          OUTPUT,
        );
    } else {
      positionAt(compiler, principal, treeSchemasPointer(at, "principal"), OUTPUT);
    }

    for (const [header, use] of treeSchemasEntries(treeSchemasMember(identity, "headers")))
      positionAt(
        compiler,
        treeSchemasMember(use, "schema"),
        treeSchemasPointer(at, "headers", header, "schema"),
        headerDirections(treeSchemasMember(merged.headers, header)),
      );
  }

  for (const [id, header] of treeSchemasEntries(merged.headers))
    positionAt(
      compiler,
      treeSchemasMember(header, "schema"),
      treeSchemasPointer("/headers", id, "schema"),
      headerDirections(header),
    );

  for (const [id, scope] of treeSchemasEntries(merged.scopes))
    positionAt(
      compiler,
      treeSchemasMember(scope, "id"),
      treeSchemasPointer("/scopes", id, "id"),
      INPUT,
    );

  for (const [id, right] of treeSchemasEntries(merged.rights)) {
    const at = treeSchemasPointer("/rights", id);
    const codeName = treeSchemasMember(right, "codeName");
    // A right without segments and without codeName is access.rights' error; its params are named once it has one.
    const segments = segmentsOf(id, "right", typeof codeName === "string" ? { codeName } : {});

    paramsAt(compiler, right, at, segments.ok ? segments.segments : [], INPUT);
    const subject = treeSchemasMember(right, "subject");

    positionAt(
      compiler,
      treeSchemasMember(subject, "id"),
      treeSchemasPointer(at, "subject", "id"),
      INPUT,
    );
  }

  for (const [id, rule] of treeSchemasEntries(merged.rules)) {
    const at = treeSchemasPointer("/rules", id);

    paramsAt(compiler, rule, at, splitName(id), INPUT);
    const proof = treeSchemasMember(rule, "proof");
    const proofPointer = treeSchemasPointer(at, "proof", "schema");

    positionAt(compiler, treeSchemasMember(proof, "schema"), proofPointer, INPUT);
    compiler.queryPositions.add(proofPointer);
  }

  // A meta field fills a success envelope, so its schema is output.
  for (const [id, format] of treeSchemasEntries(merged.formats)) {
    for (const [name, field] of treeSchemasEntries(treeSchemasMember(format, "meta")))
      positionAt(
        compiler,
        treeSchemasMember(field, "schema"),
        treeSchemasPointer("/formats", id, "meta", name, "schema"),
        OUTPUT,
      );
  }

  for (const [code, error] of treeSchemasEntries(merged.errors))
    paramsAt(compiler, error, treeSchemasPointer("/errors", code), splitName(code), OUTPUT);
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
  directions: readonly IrWriter.Direction[],
): void => {
  if (typeof fields === "string") {
    positionAt(compiler, fields, pointer, directions);

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

    compiler.position(
      schema,
      { pointer: treeSchemasPointer(pointer, key), name, place: "position" },
      directions,
    );
  }
};

// Every fields map of a route is read from the request.
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

    positionAt(compiler, settings.item, at("item"), OUTPUT);

    // A code declared on a node hoists its params as the catalogue's do (`<Code>Params`).
    for (const [code, error] of treeSchemasEntries(settings.errors))
      paramsAt(compiler, error, at("errors", code), splitName(code), OUTPUT);

    if (settings.input !== undefined)
      compiler.position(
        settings.input,
        { pointer: at("input"), name: routeName(operation, "input"), place: "routeInput" },
        INPUT,
      );

    if (settings.output !== undefined)
      compiler.position(
        settings.output,
        { pointer: at("output"), name: routeName(operation, "output"), place: "position" },
        OUTPUT,
      );

    for (const [status, response] of treeSchemasEntries(settings.responses)) {
      const body = treeSchemasMember(response, "body");

      if (body !== undefined)
        compiler.position(
          body,
          {
            pointer: at("responses", status, "body"),
            name: responseName(operation, status),
            place: "position",
          },
          OUTPUT,
        );
      routeFieldsAt(
        compiler,
        treeSchemasMember(response, "headers"),
        at("responses", status, "headers"),
        undefined,
        OUTPUT,
      );
    }

    for (const [key, role] of FIELDS_MAPS)
      routeFieldsAt(
        compiler,
        settings[key],
        at(key),
        role === undefined ? undefined : routeName(operation, role),
        INPUT,
      );

    // A query field written as a schema name has its wire at the schema's properties.
    for (const [key] of treeSchemasEntries(settings.query))
      compiler.queryPositions.add(at("query", key));
  }
}
