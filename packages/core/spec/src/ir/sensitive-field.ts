// Where the responses of an operation carry a sensitive value (ADR 0003 section 6): a property marked `sensitive`,
// or a scalar use marked `sensitive`, reached from a body through array items, JSON content, object properties, map
// keys and values and union variants, from a response header's type, or from the params schema of an error code. Each schema is walked once per holder kind,
// so a recursive schema ends. The walk reads untyped JSON: an unknown use or schema kind is the reader's to name.

type Json = Record<string, unknown>;

/**
 * A sensitive value a response carries: `field` under a property of a body (the property, or a sensitive value at
 * any depth of its type but a map key), `body` outside any property (a whole scalar body or its items), `mapKey`
 * the keys of a map schema, `header` a response header's type. `response` is the index of the response.
 */
export type IrSensitiveReach =
  | {
      readonly place: "field";
      readonly response: number;
      readonly schema: string;
      readonly property: string;
    }
  | { readonly place: "body"; readonly response: number }
  | { readonly place: "mapKey"; readonly response: number; readonly schema: string }
  | { readonly place: "header"; readonly response: number; readonly header: string };

/** Called with the id of a referenced schema that `schemas` lacks; without it the reference is skipped. */
export type IrMissingSchemaHandler = (id: string) => void;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Every sensitive value the responses carry, in response order, each body before its headers. */
export function findIrSensitiveReaches(
  responses: readonly unknown[],
  schemas: Readonly<Record<string, unknown>>,
  onMissingSchema?: IrMissingSchemaHandler,
): IrSensitiveReach[] {
  const walk: Walk = { schemas, visited: new Set<string>(), onMissingSchema, reaches: [] };

  responses.forEach((response, index) => {
    if (!isRecord(response)) return;

    walkUse(response.body, { place: "body", response: index }, walk);

    for (const header of listOf(response.headers)) {
      if (!isRecord(header)) continue;

      walkUse(header.type, { place: "header", response: index, header: String(header.name) }, walk);
    }
  });

  return walk.reaches;
}

/**
 * Every sensitive value the params schema of an error code carries, walked as the body of one response: each reach
 * has `response` 0, and is a `field` or a `mapKey` (params is an object schema).
 */
export function findIrSensitiveParamReaches(
  params: string,
  schemas: Readonly<Record<string, unknown>>,
  onMissingSchema?: IrMissingSchemaHandler,
): IrSensitiveReach[] {
  return findIrSensitiveReaches(
    [{ body: { kind: "ref", schema: params } }],
    schemas,
    onMissingSchema,
  );
}

interface Walk {
  readonly schemas: Readonly<Record<string, unknown>>;
  readonly visited: Set<string>;
  readonly onMissingSchema: IrMissingSchemaHandler | undefined;
  readonly reaches: IrSensitiveReach[];
}

// What holds the value being walked, which is also where a sensitive value below it is reported.
type Holder = Exclude<IrSensitiveReach, { place: "mapKey" }>;

function walkUse(use: unknown, holder: Holder, walk: Walk): void {
  if (!isRecord(use)) return;

  switch (use.kind) {
    case "array":
      walkUse(use.items, holder, walk);

      return;
    case "scalar":
      if (use.sensitive === true) walk.reaches.push(holder);

      if (isRecord(use.content)) walkUse(use.content.schema, holder, walk);

      return;
    case "ref":
      if (typeof use.schema === "string") walkSchema(use.schema, holder, walk);

      return;
    default:
      return;
  }
}

function walkSchema(id: string, holder: Holder, walk: Walk): void {
  const visit = `${holder.place} ${id}`;

  if (walk.visited.has(visit)) return;

  if (!Object.hasOwn(walk.schemas, id)) {
    walk.onMissingSchema?.(id);

    return;
  }

  walk.visited.add(visit);
  const schema = walk.schemas[id];

  if (!isRecord(schema)) return;

  switch (schema.kind) {
    case "object":
      walkProperties(id, schema.properties, holder, walk);

      return;
    case "map":
      if (isRecord(schema.keys) && schema.keys.sensitive === true)
        walk.reaches.push({ place: "mapKey", response: holder.response, schema: id });

      walkUse(schema.values, holder, walk);

      return;
    case "union":
      walkVariants(schema.variants, holder, walk);

      return;
    default:
      return;
  }
}

function walkProperties(id: string, properties: unknown, holder: Holder, walk: Walk): void {
  for (const property of listOf(properties)) {
    if (!isRecord(property)) continue;

    // A header keeps its own name as the holder: the header is what carries the value.
    const field: Holder =
      holder.place === "header"
        ? holder
        : {
            place: "field",
            response: holder.response,
            schema: id,
            property: String(property.name),
          };

    if (property.sensitive === true) {
      walk.reaches.push(field);

      continue;
    }

    walkUse(property.type, field, walk);
  }
}

function walkVariants(variants: unknown, holder: Holder, walk: Walk): void {
  for (const variant of listOf(variants)) {
    if (isRecord(variant) && typeof variant.schema === "string")
      walkSchema(variant.schema, holder, walk);
  }
}

/** The reach as a phrase for a message: what is sensitive and where. */
export function sensitiveReachText(reach: IrSensitiveReach): string {
  switch (reach.place) {
    case "field":
      return `the sensitive property '${reach.property}' of '${reach.schema}'`;
    case "body":
      return `a sensitive value outside any property of its body (response ${reach.response})`;
    case "mapKey":
      return `the sensitive keys of '${reach.schema}'`;
    case "header":
      return `the sensitive header '${reach.header}'`;
  }
}
