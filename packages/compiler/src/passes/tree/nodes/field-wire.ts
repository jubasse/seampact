import type { IrWriter } from "@seampact/spec/ir";
import type { TreeSchemaService } from "../../../pipeline/seam.js";

// The wire form of a form or multipart field (ADR 0002 section 7, ADR 0004 section 13): a file, a JSON text field,
// or a query wire kind with its style. access.rights computes a body proof's `wire` with the same function, so the
// two never disagree (ADR 0004 section 13, "shared rather than copied").

/** Whether a use is a file, or a list of files (a multipart field with several files). */
export function treeNodesIsFileField(use: IrWriter.TypeUse): boolean {
  return use.kind === "file" || (use.kind === "array" && use.items.kind === "file");
}

/** The wire of a field without asking the schema service: a file or a JSON text field; undefined otherwise. */
function plainWire(use: IrWriter.TypeUse): IrWriter.FieldWire | undefined {
  if (treeNodesIsFileField(use)) return { kind: "file" };
  if (use.kind === "scalar" && use.content !== undefined) return { kind: "json" };
  return undefined;
}

/**
 * The wire of a field, or undefined when the schema service has no query wire for it (an opaque value, a union):
 * the pass reports that field instead of writing it.
 */
export function treeNodesFieldWireOf(
  schemaPointer: string,
  use: IrWriter.TypeUse,
  treeSchemas: TreeSchemaService,
): IrWriter.FieldWire | undefined {
  const plain = plainWire(use);
  if (plain !== undefined) return plain;

  const wire = treeSchemas.queryWire(schemaPointer);
  if (wire === undefined) return undefined;
  return { kind: wire.kind, style: wire.style, explode: wire.explode, brackets: wire.brackets };
}

/**
 * The wire form of the form or multipart field whose schema is written at `schemaPointer` (a JSON Pointer into the
 * api's merged raw tree) and compiles to `use`: `{ kind: file }` for a file or a list of files, `{ kind: json }` for
 * a text field holding JSON (`contentMediaType: application/json`), else the query wire `treeSchemas.queryWire`
 * answers, with its style, explode and brackets. Throws when the service answers none for a field that needs one:
 * tree.schemas answers every form field and rule proof schema it accepted, and the later halves run only when it
 * reported no error.
 */
export function treeNodesFieldWire(
  schemaPointer: string,
  use: IrWriter.TypeUse,
  treeSchemas: TreeSchemaService,
): IrWriter.FieldWire {
  const wire = treeNodesFieldWireOf(schemaPointer, use, treeSchemas);
  if (wire === undefined)
    throw new Error(
      `the schema service answers no query wire for the field at ${schemaPointer}; tree.schemas answers one for ` +
        "every form field and rule proof schema it accepts",
    );
  return wire;
}
