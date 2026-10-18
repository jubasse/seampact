import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import type { DeriveWireRelated } from "./report.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// Derived parameters and response headers (ADR 0004 section 7): appended after the declared ones, in the order the
// writers run, which is the derivation table's (`derivations/table.ts`), then source order. A name already taken in
// the same list by the same derivation with the same type and requirement merges into that element, its `from`
// extended; one taken by a declared element or another derivation, or by the same derivation with another type or
// requirement, is a compile error, since a target could not tell the two apart. This half checks every clash of a
// derived name with a declared one, a query scheme's parameter included. Header names compare case-insensitively
// (RFC 9110 section 5.1), query names exactly.

/** The string type use of a header or query value that declares no schema. */
export const DERIVE_WIRE_STRING_USE: IrWriter.ScalarTypeUse = Object.freeze({
  kind: "scalar",
  type: "string",
  refinements: Object.freeze({}),
});

/** The response header of web links (RFC 8288): the paging links and the deprecation successor share it. */
export const DERIVE_WIRE_LINK = "Link";

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
  /** The query wire of a query parameter; a single text value when absent. */
  readonly wire?: IrWriter.QueryWire;
}

interface Named {
  name: string;
  type: IrWriter.TypeUse;
  required: boolean;
  origin?: IrWriter.Origin;
  derivedFrom?: IrWriter.DerivedFrom;
  semantic?: IrWriter.ResponseHeaderSemantic;
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

  if (!mergedInto(list, place, { derived, semantic: undefined }, route, scope))
    list.push({
      name: derived.name,
      type: pipelineCopy(derived.type),
      required: derived.required,
      ...(place === "query"
        ? { wire: pipelineCopy(derived.wire ?? DERIVE_WIRE_TEXT_QUERY_WIRE) }
        : {}),
      derivedFrom: pipelineCopy(derived.derivedFrom),
    });
}

/** Appends a derived response header to every success response (2xx) of the operation. */
export function deriveWireAddSuccessHeader(
  route: DeriveWireRoute,
  derived: DeriveWireDerived,
  semantic: IrWriter.ResponseHeaderSemantic | undefined,
  scope: DeriveWireScope,
): void {
  for (const response of deriveWireSuccessResponses(route))
    deriveWireAddResponseHeader(route, response, derived, semantic, scope);
}

/** Appends a derived header to one response of the operation. */
export function deriveWireAddResponseHeader(
  route: DeriveWireRoute,
  response: IrWriter.Response,
  derived: DeriveWireDerived,
  semantic: IrWriter.ResponseHeaderSemantic | undefined,
  scope: DeriveWireScope,
): void {
  if (mergedInto(response.headers, "header", { derived, semantic }, route, scope)) return;

  response.headers.push({
    name: derived.name,
    type: pipelineCopy(derived.type),
    required: derived.required,
    ...(semantic === undefined ? {} : { semantic }),
    derivedFrom: pipelineCopy(derived.derivedFrom),
  });
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

// True when the name is already in the list: merged when the same derivation wrote it with the same semantic, type
// and requirement, else reported.
function mergedInto(
  list: Named[],
  place: DeriveWireParamPlace,
  { derived, semantic }: { derived: DeriveWireDerived; semantic: Named["semantic"] },
  route: DeriveWireRoute,
  scope: DeriveWireScope,
): boolean {
  const existing = list.find((element) => sameName(place, element.name, derived.name));

  if (existing === undefined) return false;

  const record = existing.derivedFrom;

  if (record === undefined || record.derivation !== derived.derivedFrom.derivation) {
    reportCollision(
      {
        place,
        existing,
        derived,
        route,
        message: `operation '${route.id}' already has a ${place} '${existing.name}' ${describe(existing)}, so derivation ${derived.derivedFrom.derivation} cannot add its own`,
        fix: "Rename the declared parameter or header, or the name the derivation takes from its scheme, header or convention.",
      },
      scope,
    );

    return true;
  }

  if (existing.semantic !== semantic) {
    reportCollision(
      {
        place,
        existing,
        derived,
        route,
        message: `derivation ${record.derivation} writes the ${place} '${derived.name}' of operation '${route.id}' twice, as '${existing.semantic ?? "plain"}' and as '${semantic ?? "plain"}'`,
        fix: "Give each header the derivation writes its own name.",
      },
      scope,
    );

    return true;
  }

  if (!sameShape(existing, derived)) {
    reportCollision(
      {
        place,
        existing,
        derived,
        route,
        message: `derivation ${record.derivation} writes the ${place} '${derived.name}' of operation '${route.id}' twice, with a different type or requirement`,
        fix: "Give each scheme or header declaration the derivation reads its own name, or make their type and requirement agree.",
      },
      scope,
    );

    return true;
  }

  for (const origin of derived.derivedFrom.from)
    if (!record.from.some((known) => sameOrigin(known, origin)))
      record.from.push(pipelineCopy(origin));

  return true;
}

const describe = (element: Named): string =>
  element.derivedFrom === undefined
    ? "declared on the route"
    : `from derivation ${element.derivedFrom.derivation}`;

const sameOrigin = (left: IrWriter.Origin, right: IrWriter.Origin): boolean =>
  left.layer === right.layer && left.pointer === right.pointer;

// Type uses are plain data written by the IR writers, so their JSON text compares them.
const sameShape = (existing: Named, derived: DeriveWireDerived): boolean =>
  existing.required === derived.required &&
  JSON.stringify(existing.type) === JSON.stringify(derived.type);

interface Collision {
  readonly place: DeriveWireParamPlace;
  readonly existing: Named;
  readonly derived: DeriveWireDerived;
  readonly route: DeriveWireRoute;
  readonly message: string;
  readonly fix: string;
}

const COLLISION_RULE = "derived-name-collision";

// A route that declared the name taken wrote the fault, so it is located there. Otherwise both sides are derived and
// the derivation's name comes from its last authored origin (a scheme, a header declaration, a convention or a
// schema), which every route it reaches shares: the fault is reported once there, the first route in `related`.
function reportCollision(collision: Collision, scope: DeriveWireScope): void {
  const { place, existing, derived, route } = collision;
  const nameOrigin = existing.derivedFrom === undefined ? undefined : lastAuthored(derived);

  if (nameOrigin === undefined) {
    scope.reporter.error({
      rule: COLLISION_RULE,
      message: collision.message,
      fix: collision.fix,
      pointer: route.node.pointer,
      related: relatedOf(existing, derived, route.node.pointer),
    });

    return;
  }

  const key = [
    derived.derivedFrom.derivation,
    place,
    derived.name.toLowerCase(),
    nameOrigin.pointer,
  ].join(" ");

  if (scope.reportedCollisions.has(key)) return;

  scope.reportedCollisions.add(key);
  scope.reporter.error({
    rule: COLLISION_RULE,
    message: collision.message,
    fix: collision.fix,
    pointer: nameOrigin.pointer,
    related: [
      { pointer: route.node.pointer, message: "the first route it reaches" },
      ...relatedOf(existing, derived, nameOrigin.pointer),
    ],
  });
}

function lastAuthored(derived: DeriveWireDerived): IrWriter.Origin | undefined {
  return derived.derivedFrom.from.findLast((origin) => origin.layer !== "core");
}

// The authored origins of both sides but the location, a core default having none.
function relatedOf(
  existing: Named,
  derived: DeriveWireDerived,
  located: string,
): DeriveWireRelated[] {
  const existingOrigins =
    existing.origin === undefined ? (existing.derivedFrom?.from ?? []) : [existing.origin];
  const related: DeriveWireRelated[] = [];

  for (const origin of existingOrigins)
    if (origin.layer !== "core" && origin.pointer !== located)
      related.push({ pointer: origin.pointer, message: "the name taken" });

  for (const origin of derived.derivedFrom.from)
    if (origin.layer !== "core" && origin.pointer !== located)
      related.push({ pointer: origin.pointer, message: "the derivation" });

  return related;
}
