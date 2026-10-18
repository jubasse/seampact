import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import type { DeriveWireRelated } from "./report.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// Derived parameters and response headers (ADR 0004 section 7): appended after the declared ones, in the order the
// writers run, which is the derivation table's (`derivations/table.ts`), then source order. A name already taken in
// the same list by the same derivation merges into that element, its `from` extended; one taken by a declared
// element or another derivation is a compile error, since a target could not tell the two apart. Header names
// compare case-insensitively (RFC 9110 section 5.1), query names exactly.

/** The string type use of a header or query value that declares no schema. */
export const DERIVE_WIRE_STRING_USE: IrWriter.ScalarTypeUse = Object.freeze({
  kind: "scalar",
  type: "string",
  refinements: Object.freeze({}),
});

/** The query wire of a single text value: `name=value`, as a query credential travels. */
export const DERIVE_WIRE_TEXT_QUERY_WIRE: IrWriter.QueryWire = Object.freeze({
  kind: "text",
  style: "form",
  explode: true,
  brackets: false,
});

export type DeriveWireParamPlace = "header" | "query";

/** A derived element to write: its name, type, whether it is required, and its derivation record. */
export interface DeriveWireDerived {
  readonly name: string;
  readonly type: IrWriter.TypeUse;
  readonly required: boolean;
  readonly derivedFrom: IrWriter.DerivedFrom;
}

interface Named {
  name: string;
  origin?: IrWriter.Origin;
  derivedFrom?: IrWriter.DerivedFrom;
}

const sameName = (place: DeriveWireParamPlace, left: string, right: string): boolean =>
  place === "query" ? left === right : left.toLowerCase() === right.toLowerCase();

/** Appends a derived request parameter to the operation's `place` list. */
export function deriveWireAddParam(
  route: DeriveWireRoute,
  place: DeriveWireParamPlace,
  derived: DeriveWireDerived,
  scope: DeriveWireScope,
): void {
  const params = route.operation.params;

  if (params === undefined)
    throw new Error(`tree.nodes wrote no params on operation '${route.id}'`);

  const list = params[place];

  if (!mergedInto(list, place, derived, route, scope))
    list.push({
      name: derived.name,
      type: pipelineCopy(derived.type),
      required: derived.required,
      ...(place === "query" ? { wire: pipelineCopy(DERIVE_WIRE_TEXT_QUERY_WIRE) } : {}),
      derivedFrom: pipelineCopy(derived.derivedFrom),
    });
}

/** Appends a derived response header to every success response (2xx) of the operation. */
export function deriveWireAddSuccessHeader(
  route: DeriveWireRoute,
  derived: DeriveWireDerived,
  semantic: string | undefined,
  scope: DeriveWireScope,
): void {
  for (const response of deriveWireSuccessResponses(route)) {
    if (mergedInto(response.headers, "header", derived, route, scope)) continue;

    response.headers.push({
      name: derived.name,
      type: pipelineCopy(derived.type),
      required: derived.required,
      ...(semantic === undefined ? {} : { semantic }),
      derivedFrom: pipelineCopy(derived.derivedFrom),
    });
  }
}

const SUCCESS_FIRST = 200;
const SUCCESS_LAST = 299;

/** The success responses of the operation tree.nodes wrote, 2xx only: a redirect or a 304 is no success. */
export function deriveWireSuccessResponses(route: DeriveWireRoute): IrWriter.Response[] {
  const responses = route.operation.responses;

  if (responses === undefined)
    throw new Error(`tree.nodes wrote no responses on operation '${route.id}'`);

  return responses.filter(
    (response) => response.status >= SUCCESS_FIRST && response.status <= SUCCESS_LAST,
  );
}

// True when the name is already in the list: merged when the same derivation wrote it, else reported.
function mergedInto(
  list: Named[],
  place: DeriveWireParamPlace,
  derived: DeriveWireDerived,
  route: DeriveWireRoute,
  scope: DeriveWireScope,
): boolean {
  const existing = list.find((element) => sameName(place, element.name, derived.name));

  if (existing === undefined) return false;

  const record = existing.derivedFrom;

  if (record !== undefined && record.derivation === derived.derivedFrom.derivation) {
    for (const origin of derived.derivedFrom.from)
      if (!record.from.some((known) => sameOrigin(known, origin)))
        record.from.push(pipelineCopy(origin));

    return true;
  }

  scope.reporter.error({
    rule: "derived-param-collision",
    message: `operation '${route.id}' already has a ${place} '${existing.name}' ${describe(existing)}, so derivation ${derived.derivedFrom.derivation} cannot add its own`,
    fix: "Rename the declared parameter or header, or the name the derivation takes from its scheme, header or convention.",
    pointer: route.node.pointer,
    related: relatedOf(existing, derived),
  });

  return true;
}

const describe = (element: Named): string =>
  element.derivedFrom === undefined
    ? "declared on the route"
    : `from derivation ${element.derivedFrom.derivation}`;

const sameOrigin = (left: IrWriter.Origin, right: IrWriter.Origin): boolean =>
  left.layer === right.layer && left.pointer === right.pointer;

// The authored origins of both sides, a core default having none.
function relatedOf(existing: Named, derived: DeriveWireDerived): DeriveWireRelated[] {
  const existingOrigins =
    existing.origin === undefined ? (existing.derivedFrom?.from ?? []) : [existing.origin];
  const related: DeriveWireRelated[] = [];

  for (const origin of existingOrigins)
    if (origin.layer !== "core")
      related.push({ pointer: origin.pointer, message: "the name taken" });

  for (const origin of derived.derivedFrom.from)
    if (origin.layer !== "core")
      related.push({ pointer: origin.pointer, message: "the derivation" });

  return related;
}
