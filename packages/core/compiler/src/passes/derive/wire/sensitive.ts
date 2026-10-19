import { findIrSensitiveProperty, type IrWriter } from "@seampact/spec/ir";
import type { PassReadonly } from "../../../pipeline/seam.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The first sensitive property a response of the operation carries (ADR 0003 section 6): the walk is the IR
// invariant's, shared from `@seampact/spec/ir`; this adds the property's origin and refuses a schema that
// tree.schemas did not write.

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
  const bodies = (route.operation.responses ?? []).map((response) => response.body);

  const found = findIrSensitiveProperty(bodies, scope.draft.schemas, (id) => {
    throw new Error(`a response references schema '${id}', which tree.schemas did not write`);
  });

  if (found === undefined) return undefined;

  return { ...found, origin: sensitivePropertyOrigin(found, scope.draft.schemas) };
}

function sensitivePropertyOrigin(
  found: { readonly schema: string; readonly property: string },
  schemas: DeriveWireScope["draft"]["schemas"],
): IrWriter.Origin {
  const schema: PassReadonly<IrWriter.Schema> | undefined = schemas[found.schema];

  if (schema?.kind !== "object")
    throw new Error(`the sensitive property '${found.property}' is not in an object schema`);

  const property = schema.properties.find((candidate) => candidate.name === found.property);

  if (property === undefined)
    throw new Error(`schema '${found.schema}' lost the sensitive property '${found.property}'`);

  return property.origin;
}
