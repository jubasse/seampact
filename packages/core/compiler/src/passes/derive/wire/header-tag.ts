import { pipelineCopy } from "../../../pipeline/seam.js";
import { DERIVE_WIRE_STRING_USE, deriveWireAddParam } from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The tag header of a header-tagged union input (`union.headerTag`, ADR 0003 section 3): a required request header
// parameter. Its values are the union's tags, which the input's union schema lists in `variants`; a header type
// use holds no inline value list, so the parameter is a string and a target reads the values from that schema.
// tree.schemas refuses the header declared again among the route's headers, so the name is free here.

const HEADER_TAG = "union.headerTag";

/** Writes the tag header parameter of a route whose whole input is a header-tagged union. */
export function deriveWireHeaderTag(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const use = route.operation.input?.schema;

  if (use?.kind !== "ref") return;

  const schemas = scope.draft.schemas;
  const schema = Object.hasOwn(schemas, use.schema) ? schemas[use.schema] : undefined;

  if (schema?.kind !== "union" || schema.tag.in !== "header") return;

  deriveWireAddParam(
    route,
    "header",
    {
      name: schema.tag.name,
      type: DERIVE_WIRE_STRING_USE,
      required: true,
      derivedFrom: { derivation: HEADER_TAG, from: [pipelineCopy(schema.origin)] },
    },
    scope,
  );
}
