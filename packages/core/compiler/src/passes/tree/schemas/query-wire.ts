import type { IrWriter } from "@seampact/spec/ir";
import type { ResolvedConventions } from "../../../pipeline/seam.js";
import type { TreeSchemasCompiler } from "./compile.js";
import { treeSchemasPointer } from "./raw.js";

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

/** The query wires of one run: every object property, query field and rule proof whose use has one. */
export function treeSchemasQueryWires(
  compiler: TreeSchemasCompiler,
  conventions: ResolvedConventions,
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

  for (const pointer of compiler.queryPositions) record(pointer, compiler.uses.get(pointer));

  return wires;
}
