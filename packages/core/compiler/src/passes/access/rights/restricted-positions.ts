import type { IrWriter } from "@seampact/spec/ir";
import { type PassReadonly, pipelinePointerBelow } from "../../../pipeline/seam.js";
import { accessRightsEntries, accessRightsMember } from "./read.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import {
  type AccessRightsDraftSchemas,
  accessRightsRefuseRestrictionsBelow,
} from "./restricted-fields.js";
import type { AccessRightsRestrictionChecks } from "./restrictions.js";
import type { AccessRightsRoute } from "./routes.js";
import type { AccessRightsContext } from "./schema-use.js";

// The positions other than a body from which a restricted field is refused (ADR 0003 section 6): a query
// parameter, a request or response header, and an error's params. The IR lists the field rights of an input and
// a response body only, so a restriction reached there would never be enforced.

interface PositionWalk {
  readonly reporter: AccessRightsReporter;
  readonly schemas: AccessRightsDraftSchemas;
  readonly checks: AccessRightsRestrictionChecks;
}

type Positioned = PassReadonly<{ name: string; type: IrWriter.TypeUse; origin?: IrWriter.Origin }>;

// A derived position has a core origin, which a diagnostic cannot point at.
const authoredPointer = (origin: PassReadonly<IrWriter.Origin> | undefined): string | undefined =>
  origin === undefined || origin.layer === "core" ? undefined : origin.pointer;

/** Refuses a restricted field reached from the route's query parameters, request headers or response headers. */
export function accessRightsRefuseRoutePositions(
  walk: PositionWalk,
  route: AccessRightsRoute,
): void {
  const { operation } = route;
  const refuse = (positioned: Positioned, kind: string) =>
    accessRightsRefuseRestrictionsBelow(walk, positioned.type, {
      text: `${kind} '${accessRightsQuoted(positioned.name)}' of route '${route.id}'`,
      ...optionalPointer(authoredPointer(positioned.origin)),
    });

  for (const parameter of operation.params?.query ?? []) refuse(parameter, "query parameter");

  for (const header of operation.params?.header ?? []) refuse(header, "request header");

  for (const response of operation.responses ?? [])
    for (const header of response.headers ?? []) refuse(header, "response header");
}

const optionalPointer = (pointer: string | undefined): { pointer?: string } =>
  pointer === undefined ? {} : { pointer };

/** Refuses a restricted field reached from the params of an error the contract declares, whatever route answers it. */
export function accessRightsRefuseErrorParams(
  context: AccessRightsContext,
  walk: PositionWalk,
): void {
  for (const [code, error] of accessRightsEntries(context.raw.merged, "errors")) {
    if (accessRightsMember(error, "params") === undefined) continue;

    const pointer = pipelinePointerBelow("/errors", code, "params");

    accessRightsRefuseRestrictionsBelow(walk, errorParamsUse(context, walk.schemas, pointer), {
      text: `the params of error '${accessRightsQuoted(code)}'`,
      pointer,
    });
  }
}

// The params of a default code the layer redeclares take the code's reserved schema id, which the schema service
// does not answer for that position: that schema is found by its origin instead.
function errorParamsUse(
  context: AccessRightsContext,
  schemas: AccessRightsDraftSchemas,
  pointer: string,
): PassReadonly<IrWriter.TypeUse> {
  const use = context.treeSchemas.typeUse(pointer, "output");

  if (use !== undefined) return use;

  const reserved = Object.values(schemas).find(
    (schema) => schema.origin.layer !== "core" && schema.origin.pointer === pointer,
  );

  if (reserved === undefined)
    throw new Error(`tree.schemas compiled no schema for the error params written at ${pointer}`);

  return { kind: "ref", schema: reserved.id };
}
