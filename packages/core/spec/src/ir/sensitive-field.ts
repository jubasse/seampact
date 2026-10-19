// The first sensitive property a set of response bodies reaches (ADR 0003 section 6): through array items, JSON
// content, object properties, map values and union variants, each schema walked once so a recursive schema ends.
// The walk reads untyped JSON: an unknown use or schema kind is the reader's to name.

type Json = Record<string, unknown>;

/** A sensitive property and the schema holding it. */
export interface IrSensitiveProperty {
  readonly schema: string;
  readonly property: string;
}

/** Called with the id of a referenced schema that `schemas` lacks; without it the reference is skipped. */
export type IrMissingSchemaHandler = (id: string) => void;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The first sensitive property the bodies reach, in body then property order. */
export function findIrSensitiveProperty(
  bodies: readonly unknown[],
  schemas: Readonly<Record<string, unknown>>,
  onMissingSchema?: IrMissingSchemaHandler,
): IrSensitiveProperty | undefined {
  const walk: Walk = { schemas, visited: new Set<string>(), onMissingSchema };

  for (const body of bodies) {
    const found = sensitiveBelow(body, walk);

    if (found !== undefined) return found;
  }

  return undefined;
}

interface Walk {
  readonly schemas: Readonly<Record<string, unknown>>;
  readonly visited: Set<string>;
  readonly onMissingSchema: IrMissingSchemaHandler | undefined;
}

function sensitiveBelow(use: unknown, walk: Walk): IrSensitiveProperty | undefined {
  if (!isRecord(use)) return undefined;

  switch (use.kind) {
    case "array":
      return sensitiveBelow(use.items, walk);
    case "scalar":
      return isRecord(use.content) ? sensitiveBelow(use.content.schema, walk) : undefined;
    case "ref":
      return typeof use.schema === "string" ? sensitiveInSchema(use.schema, walk) : undefined;
    default:
      return undefined;
  }
}

function sensitiveInSchema(id: string, walk: Walk): IrSensitiveProperty | undefined {
  if (walk.visited.has(id)) return undefined;

  if (!Object.hasOwn(walk.schemas, id)) {
    walk.onMissingSchema?.(id);

    return undefined;
  }

  walk.visited.add(id);
  const schema = walk.schemas[id];

  if (!isRecord(schema)) return undefined;

  switch (schema.kind) {
    case "object":
      return sensitiveProperty(id, schema.properties, walk);
    case "map":
      return sensitiveBelow(schema.values, walk);
    case "union":
      return sensitiveVariant(schema.variants, walk);
    default:
      return undefined;
  }
}

function sensitiveProperty(
  id: string,
  properties: unknown,
  walk: Walk,
): IrSensitiveProperty | undefined {
  for (const property of Array.isArray(properties) ? properties : []) {
    if (!isRecord(property)) continue;

    if (property.sensitive === true) return { schema: id, property: String(property.name) };

    const found = sensitiveBelow(property.type, walk);

    if (found !== undefined) return found;
  }

  return undefined;
}

function sensitiveVariant(variants: unknown, walk: Walk): IrSensitiveProperty | undefined {
  for (const variant of Array.isArray(variants) ? variants : []) {
    if (!isRecord(variant) || typeof variant.schema !== "string") continue;

    const found = sensitiveInSchema(variant.schema, walk);

    if (found !== undefined) return found;
  }

  return undefined;
}
