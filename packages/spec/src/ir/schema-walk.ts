import type { SchemaNode } from "./schemas.js";

// The keywords of the IR schema files whose values are subschemas, by how they hold them. Every other keyword
// holds data (`required`, `const`, `x-seampact-known`, `description`, ...), never a schema.
const SCHEMA_MAPS = ["$defs", "properties"] as const;
const SCHEMA_VALUES = ["items", "additionalProperties", "propertyNames"] as const;
const SCHEMA_LISTS = ["oneOf"] as const;

export const isSchemaNode = (value: unknown): value is SchemaNode =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Calls `visit` on `node` and every subschema below it, with the JSON Pointer of each inside its file.
export function walkSchema(
  node: SchemaNode,
  visit: (node: SchemaNode, pointer: string, parentKeyword: string | undefined) => void,
  pointer = "",
  parentKeyword?: string,
): void {
  visit(node, pointer, parentKeyword);
  for (const keyword of SCHEMA_MAPS) {
    const children = node[keyword];
    if (!isSchemaNode(children)) continue;
    for (const [name, child] of Object.entries(children)) {
      if (isSchemaNode(child))
        walkSchema(child, visit, `${pointer}/${keyword}/${escapePointer(name)}`, keyword);
    }
  }
  for (const keyword of SCHEMA_VALUES) {
    const child = node[keyword];
    if (isSchemaNode(child)) walkSchema(child, visit, `${pointer}/${keyword}`, keyword);
  }
  for (const keyword of SCHEMA_LISTS) {
    const children = node[keyword];
    if (!Array.isArray(children)) continue;
    children.forEach((child, index) => {
      if (isSchemaNode(child)) walkSchema(child, visit, `${pointer}/${keyword}/${index}`, keyword);
    });
  }
}

export const escapePointer = (segment: string): string =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1");
