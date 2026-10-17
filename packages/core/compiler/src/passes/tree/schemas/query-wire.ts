import type { IrWriter } from "@seampact/spec/ir";
import type { InheritedReader, ResolvedConventions, TreeNode } from "../../../pipeline/seam.js";
import type { TreeSchemasCompiler } from "./compile.js";
import { treeSchemasMember, treeSchemasPointer } from "./raw.js";

// Query wire kinds (FR-30, ADR 0002 section 7): a query field, or a form or multipart field, travels as a number,
// a boolean, text (a string or an enum), a list of those, or an object of those. How a list and an object travel
// is `conventions.query.lists` and `conventions.query.objects`. Any other use has no query wire.

type Encoding = Pick<IrWriter.QueryWire, "style" | "explode" | "brackets">;

const SINGLE: Encoding = { style: "form", explode: true, brackets: false };

const LISTS: Readonly<Record<string, Encoding>> = {
  repeat: SINGLE,
  comma: { style: "form", explode: false, brackets: false },
  brackets: { style: "form", explode: true, brackets: true },
};

const OBJECTS: Readonly<Record<string, Encoding>> = {
  explode: SINGLE,
  deepObject: { style: "deepObject", explode: true, brackets: false },
};

function encodingOf(
  conventions: ResolvedConventions,
  path: "query.lists" | "query.objects",
  table: Readonly<Record<string, Encoding>>,
): Encoding {
  const value = conventions.get(path)?.value;
  const encoding =
    typeof value === "string" && Object.hasOwn(table, value) ? table[value] : undefined;

  if (encoding === undefined)
    throw new Error(`conventions.${path} is '${String(value)}', which validate refuses`);

  return encoding;
}

type SingleKind = Exclude<IrWriter.QueryWireKind, "list" | "object">;

function singleKind(use: IrWriter.TypeUse): SingleKind | undefined {
  if (use.kind === "enum") return "text";

  if (use.kind !== "scalar") return undefined;

  if (use.type === "string") return "text";

  if (use.type === "boolean") return "boolean";

  return use.type === "integer" || use.type === "number" ? "number" : undefined;
}

const isListOfSingles = (use: IrWriter.TypeUse): boolean =>
  use.kind === "array" && singleKind(use.items) !== undefined;

// The `inputMedia` words whose body names each value by a field, as a query string does.
const FIELD_MEDIA: ReadonlySet<string> = new Set(["form", "multipart"]);

const ROUTE_KINDS: ReadonlySet<TreeNode["kind"]> = new Set(["route", "op"]);

/**
 * The body proofs a form or multipart input carries as a field (ADR 0002 section 9): each rule proof schema
 * pointer, with the input pointer of the first route or `ops` entry, declaring `input`, whose requirements name
 * the rule.
 */
export function treeSchemasFormProofRoutes(
  nodes: readonly TreeNode[],
  inherited: InheritedReader,
): Map<string, string> {
  const routes = new Map<string, string>();

  for (const node of nodes) {
    const media = node.settings.inputMedia;

    if (!ROUTE_KINDS.has(node.kind) || !Object.hasOwn(node.settings, "input")) continue;

    if (typeof media !== "string" || !FIELD_MEDIA.has(media)) continue;

    for (const { value } of inherited(node, "requires")?.entries ?? []) {
      const rule = treeSchemasMember(value, "rule");

      if (typeof rule !== "string") continue;
      const proofSchema = treeSchemasPointer("/rules", rule, "proof", "schema");

      if (!routes.has(proofSchema))
        routes.set(proofSchema, treeSchemasPointer(node.pointer, "inputMedia"));
    }
  }

  return routes;
}

/**
 * The query wires of one run: every object property, query field and rule proof whose use has one. A map is
 * refused in a query field, a header proof, or a body proof `formProofs` names (its form or multipart route).
 */
export function treeSchemasQueryWires(
  compiler: TreeSchemasCompiler,
  conventions: ResolvedConventions,
  formProofs: ReadonlyMap<string, string>,
): Map<string, IrWriter.QueryWire> {
  const lists = encodingOf(conventions, "query.lists", LISTS);
  const objects = encodingOf(conventions, "query.objects", OBJECTS);
  const wires = new Map<string, IrWriter.QueryWire>();

  const wireOf = (use: IrWriter.TypeUse): IrWriter.QueryWire | undefined => {
    const single = singleKind(use);

    if (single !== undefined) return { kind: single, ...SINGLE };

    if (isListOfSingles(use)) return { kind: "list", ...lists };
    const properties = compiler.objectProperties(use);
    const flat = properties?.every(
      ({ type }) => singleKind(type) !== undefined || isListOfSingles(type),
    );

    return flat === true ? { kind: "object", ...objects } : undefined;
  };

  const record = (pointer: string, use: IrWriter.TypeUse | undefined): void => {
    const wire = use === undefined ? undefined : wireOf(use);

    if (wire !== undefined) wires.set(pointer, wire);
  };

  for (const [id, pointer] of compiler.writtenAt) {
    for (const property of compiler.objectProperties({ kind: "ref", schema: id }) ?? [])
      record(treeSchemasPointer(pointer, "properties", property.name), property.type);
  }

  for (const pointer of compiler.queryPositions) {
    const use = compiler.uses.get(pointer);

    const formRoute = formProofs.get(pointer);

    if (!isMap(compiler, use)) record(pointer, use);
    else if (!compiler.bodyProofPositions.has(pointer)) refuseMapField(compiler, pointer);
    else if (formRoute !== undefined) refuseMapFormProof(compiler, pointer, formRoute);
  }

  return wires;
}

const isMap = (compiler: TreeSchemasCompiler, use: IrWriter.TypeUse | undefined): boolean =>
  use?.kind === "ref" && compiler.schemas.get(use.schema)?.kind === "map";

// A query string, a form or a header names each value by a declared key: no wire encodes a map's free keys.
function refuseMapField(compiler: TreeSchemasCompiler, pointer: string): void {
  compiler.reporter.error({
    rule: "query-map",
    pointer,
    message: "a query field or header proof holds no map: no query wire encodes its keys",
    fix: "declare the keys as the fields of an object, or send the value in a JSON body",
  });
}

// A body proof on a form or multipart route travels as one more field of the form.
function refuseMapFormProof(compiler: TreeSchemasCompiler, pointer: string, route: string): void {
  compiler.reporter.error({
    rule: "query-map",
    pointer,
    message:
      "this body proof holds a map, and a form or multipart route sends it as a field: no field wire encodes its keys",
    fix: "declare the keys as the fields of an object, or send the route's input as JSON",
    related: [{ pointer: route, message: "the route sends its input as a form" }],
  });
}
