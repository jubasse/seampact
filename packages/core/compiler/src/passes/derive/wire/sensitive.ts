import { findIrSensitiveReaches, type IrSensitiveReach, type IrWriter } from "@seampact/spec/ir";
import type { PassReadonly } from "../../../pipeline/seam.js";
import { type DeriveWireRoute, type DeriveWireScope, deriveWireOriginAt } from "./routes.js";

// The sensitive values the responses of the operation carry (ADR 0003 section 6): the walk is the IR invariant's,
// shared from `@seampact/spec/ir`; this adds each value's origin and text, and refuses a schema that tree.schemas
// did not write. A field of a success body is always no-store; a value elsewhere (a whole body or its items, a map
// key, a response header) follows `conventions.cache.sensitiveElsewhere`, read by the cache writer.

/** A sensitive value a response carries, where it is written and how a message names it. */
export interface DeriveWireSensitiveValue {
  readonly reach: IrSensitiveReach;
  readonly origin: IrWriter.Origin;
  /** `the sensitive field 'Key.secret'`, `the sensitive header 'X-Token' of a 200 response`. */
  readonly text: string;
}

/** The first sensitive field of a body, and the first sensitive value elsewhere, in response order. */
export interface DeriveWireSensitive {
  readonly field: DeriveWireSensitiveValue | undefined;
  readonly elsewhere: DeriveWireSensitiveValue | undefined;
}

type Schemas = DeriveWireScope["draft"]["schemas"];

/** The sensitive values the responses of the operation carry. */
export function deriveWireSensitive(
  route: DeriveWireRoute,
  scope: DeriveWireScope,
): DeriveWireSensitive {
  const responses = route.operation.responses ?? [];
  const reaches = findIrSensitiveReaches(responses, scope.draft.schemas, (id) => {
    throw new Error(`a response references schema '${id}', which tree.schemas did not write`);
  });
  const field = reaches.find((reach) => reach.place === "field");
  const elsewhere = reaches.find((reach) => reach.place !== "field");

  return {
    field: field === undefined ? undefined : sensitiveValueOf(field, route, scope),
    elsewhere: elsewhere === undefined ? undefined : sensitiveValueOf(elsewhere, route, scope),
  };
}

function sensitiveValueOf(
  reach: IrSensitiveReach,
  route: DeriveWireRoute,
  scope: DeriveWireScope,
): DeriveWireSensitiveValue {
  const schemas = scope.draft.schemas;
  const response = route.operation.responses?.[reach.response];
  const responseOrigin = () => response?.origin ?? deriveWireOriginAt(scope, route.node.pointer);

  if (response === undefined)
    throw new Error(
      `the sensitive walk named response ${reach.response}, which the operation lacks`,
    );

  switch (reach.place) {
    case "field":
      return {
        reach,
        origin: propertyOrigin(reach, schemas),
        text: `the sensitive field '${reach.schema}.${reach.property}'`,
      };
    case "body":
      return {
        reach,
        origin: responseOrigin(),
        text: `a sensitive value as the body of a ${response.status} response`,
      };
    case "mapKey":
      return {
        reach,
        origin: schemaOrigin(reach.schema, schemas),
        text: `the sensitive keys of map '${reach.schema}' in a ${response.status} response`,
      };
    case "header":
      return {
        reach,
        origin:
          response.headers.find((header) => header.name === reach.header)?.origin ??
          responseOrigin(),
        text: `the sensitive header '${reach.header}' of a ${response.status} response`,
      };
  }
}

function schemaOrigin(id: string, schemas: Schemas): IrWriter.Origin {
  const schema: PassReadonly<IrWriter.Schema> | undefined = schemas[id];

  if (schema === undefined)
    throw new Error(`the sensitive walk named schema '${id}', which is gone`);

  return schema.origin;
}

function propertyOrigin(
  found: { readonly schema: string; readonly property: string },
  schemas: Schemas,
): IrWriter.Origin {
  const schema: PassReadonly<IrWriter.Schema> | undefined = schemas[found.schema];

  if (schema?.kind !== "object")
    throw new Error(`the sensitive property '${found.property}' is not in an object schema`);

  const property = schema.properties.find((candidate) => candidate.name === found.property);

  if (property === undefined)
    throw new Error(`schema '${found.schema}' lost the sensitive property '${found.property}'`);

  return property.origin;
}
