import common from "../../schemas/ir/common.schema.json" with { type: "json" };
import declarations from "../../schemas/ir/declarations.schema.json" with { type: "json" };
import formats from "../../schemas/ir/formats.schema.json" with { type: "json" };
import ir from "../../schemas/ir/ir.schema.json" with { type: "json" };
import operation from "../../schemas/ir/operation.schema.json" with { type: "json" };
import schemas from "../../schemas/ir/schemas.schema.json" with { type: "json" };
import sourceMap from "../../schemas/ir/source-map.schema.json" with { type: "json" };

// A JSON Schema node, read structurally: the IR schema files are data, never typed by their literal shape.
export type SchemaNode = { readonly [keyword: string]: unknown };

export const IR_SCHEMA_BASE = "https://seampact.dev/schemas/ir/";
export const IR_SCHEMA_ID = `${IR_SCHEMA_BASE}ir.schema.json`;
export const SOURCE_MAP_SCHEMA_ID = `${IR_SCHEMA_BASE}source-map.schema.json`;

// Every file of `schemas/ir/`, in a fixed order (generation and the walking tests read them in this order).
export const IR_SCHEMA_DOCUMENTS: readonly SchemaNode[] = [
  common,
  declarations,
  schemas,
  operation,
  formats,
  ir,
  sourceMap,
];
