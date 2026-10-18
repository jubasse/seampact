import type { IrWriter } from "@seampact/spec/ir";
import type { PassReadonly } from "../../../pipeline/seam.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The first sensitive property a response of the operation carries (ADR 0003 section 6): reached from a response
// body through object properties, array items, map values, union variants and JSON content, each schema walked
// once, so a recursive schema ends.

type DraftSchemas = DeriveWireScope["draft"]["schemas"];
type TypeUse = PassReadonly<IrWriter.TypeUse>;

/** A sensitive property and the schema holding it. */
export interface DeriveWireSensitiveField {
  readonly schema: string;
  readonly property: string;
  readonly origin: IrWriter.Origin;
}

/** The first sensitive property the responses of the operation carry, in response then property order. */
export function deriveWireSensitiveField(
  route: DeriveWireRoute,
  scope: DeriveWireScope,
): DeriveWireSensitiveField | undefined {
  const visited = new Set<string>();

  for (const response of route.operation.responses ?? []) {
    const found =
      response.body === undefined
        ? undefined
        : sensitiveBelow(response.body, scope.draft.schemas, visited);

    if (found !== undefined) return found;
  }

  return undefined;
}

function sensitiveBelow(
  use: TypeUse,
  schemas: DraftSchemas,
  visited: Set<string>,
): DeriveWireSensitiveField | undefined {
  switch (use.kind) {
    case "array":
      return sensitiveBelow(use.items, schemas, visited);
    case "scalar":
      return use.content === undefined
        ? undefined
        : sensitiveBelow(use.content.schema, schemas, visited);
    case "ref":
      return sensitiveInSchema(use.schema, schemas, visited);
    default:
      return undefined;
  }
}

function sensitiveInSchema(
  id: string,
  schemas: DraftSchemas,
  visited: Set<string>,
): DeriveWireSensitiveField | undefined {
  if (visited.has(id)) return undefined;

  visited.add(id);

  const schema = Object.hasOwn(schemas, id) ? schemas[id] : undefined;

  if (schema === undefined)
    throw new Error(`a response references schema '${id}', which tree.schemas did not write`);

  switch (schema.kind) {
    case "object":
      return sensitiveProperty(id, schema.properties, schemas, visited);
    case "map":
      return sensitiveBelow(schema.values, schemas, visited);
    case "union":
      for (const variant of schema.variants) {
        const found = sensitiveInSchema(variant.schema, schemas, visited);

        if (found !== undefined) return found;
      }

      return undefined;
  }
}

function sensitiveProperty(
  id: string,
  properties: readonly PassReadonly<IrWriter.Property>[],
  schemas: DraftSchemas,
  visited: Set<string>,
): DeriveWireSensitiveField | undefined {
  for (const property of properties) {
    if (property.sensitive) return { schema: id, property: property.name, origin: property.origin };

    const found = sensitiveBelow(property.type, schemas, visited);

    if (found !== undefined) return found;
  }

  return undefined;
}
