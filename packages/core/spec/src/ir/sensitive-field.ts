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

// One thing still to do, in the order the walk meets it: report a reach, or walk a use or a schema.
type Step =
  | { readonly step: "reach"; readonly reach: IrSensitiveReach }
  | { readonly step: "use"; readonly use: unknown; readonly holder: Holder }
  | { readonly step: "schema"; readonly id: string; readonly holder: Holder };

// An explicit stack, so a long chain of schemas cannot overflow the call stack. Each step pushes its children
// in reverse, so they come off in the order a recursive walk would meet them.
function walkUse(use: unknown, holder: Holder, walk: Walk): void {
  const pending: Step[] = [{ step: "use", use, holder }];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    for (const child of stepsOf(next, walk).toReversed()) pending.push(child);
  }
}

function stepsOf(next: Step, walk: Walk): Step[] {
  switch (next.step) {
    case "reach":
      walk.reaches.push(next.reach);

      return [];
    case "use":
      return stepsOfUse(next.use, next.holder);
    case "schema":
      return stepsOfSchema(next.id, next.holder, walk);
  }
}

function stepsOfUse(use: unknown, holder: Holder): Step[] {
  if (!isRecord(use)) return [];

  switch (use.kind) {
    case "array":
      return [{ step: "use", use: use.items, holder }];
    case "scalar":
      return [
        ...(use.sensitive === true ? [{ step: "reach", reach: holder } as const] : []),
        ...(isRecord(use.content)
          ? [{ step: "use", use: use.content.schema, holder } as const]
          : []),
      ];
    case "ref":
      return typeof use.schema === "string" ? [{ step: "schema", id: use.schema, holder }] : [];
    default:
      return [];
  }
}

function stepsOfSchema(id: string, holder: Holder, walk: Walk): Step[] {
  const visit = `${holder.place} ${id}`;

  if (walk.visited.has(visit)) return [];

  if (!Object.hasOwn(walk.schemas, id)) {
    walk.onMissingSchema?.(id);

    return [];
  }

  walk.visited.add(visit);
  const schema = walk.schemas[id];

  if (!isRecord(schema)) return [];

  switch (schema.kind) {
    case "object":
      return stepsOfProperties(id, schema.properties, holder);
    case "map":
      return [
        ...(isRecord(schema.keys) && schema.keys.sensitive === true
          ? [
              {
                step: "reach",
                reach: { place: "mapKey", response: holder.response, schema: id },
              } as const,
            ]
          : []),
        { step: "use", use: schema.values, holder },
      ];
    case "union":
      return stepsOfVariants(schema.variants, holder);
    default:
      return [];
  }
}

function stepsOfProperties(id: string, properties: unknown, holder: Holder): Step[] {
  const steps: Step[] = [];

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

    if (property.sensitive === true) steps.push({ step: "reach", reach: field });
    else steps.push({ step: "use", use: property.type, holder: field });
  }

  return steps;
}

function stepsOfVariants(variants: unknown, holder: Holder): Step[] {
  const steps: Step[] = [];

  for (const variant of listOf(variants))
    if (isRecord(variant) && typeof variant.schema === "string")
      steps.push({ step: "schema", id: variant.schema, holder });

  return steps;
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
