import type { IrWriter } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import {
  DERIVE_WIRE_STRING_USE,
  type DeriveWireDerived,
  deriveWireAddParam,
  deriveWireAddResponseHeader,
} from "./params.js";
import type { DeriveWireRoute, DeriveWireScope } from "./routes.js";

// The request parameters and page headers of a paged list (`paging.params`, ADR 0002 section 14, ADR 0006
// section 5), from the style tree.nodes resolved and the limits it wrote. Every parameter is optional: a request
// without a position reads the first page, without a limit `defaultLimit`. A cursor, `after`, `before` or opaque
// `since` is a string, an instant `since` a `date-time`; a page counts from its `base`, an offset from 0, and a limit
// from 1 to `maxLimit`, the bound written only with `overLimit: reject`, since a clamped limit is served, not
// refused. The sort parameter follows its `style`: `signed` one comma-separated list (`sort=-createdAt,title`),
// `pair` a repeated one (`sort=createdAt,desc`), `keyed` one parameter per sort key (`order[createdAt]=desc`) and
// `split` the key and its direction parameter; the keys themselves are `paging.sortKeys`. The style's response
// headers, and one `Link` header for its relations, go on the `page` response, each optional since a template slot
// may be absent at either end of the list. The page shape itself is tree.nodes'.

const PAGING = "paging.params";

const LINK = "Link";

const KEY_PLACEHOLDER = "{key}";

const DEFAULT_PAGE_BASE = 1;

const NUMBER_QUERY_WIRE: IrWriter.QueryWire = Object.freeze({
  kind: "number",
  style: "form",
  explode: true,
  brackets: false,
});

type Role = IrWriter.PagingRequestRole;

interface Paged {
  readonly paging: IrWriter.Paging;
  readonly style: IrWriter.PagingStyle;
  readonly derivedFrom: IrWriter.DerivedFrom;
}

/** Writes the request parameters of the route's paging style and the headers of its page response. */
export function deriveWirePaging(route: DeriveWireRoute, scope: DeriveWireScope): void {
  const paging = route.operation.paging;

  if (paging?.style === undefined) return;

  const pagings = scope.draft.pagings;
  const style = Object.hasOwn(pagings, paging.style) ? pagings[paging.style] : undefined;

  if (style === undefined)
    throw new Error(
      `tree.nodes wrote paging style '${paging.style}' on '${route.id}', which is no style`,
    );

  const paged: Paged = {
    paging,
    style,
    derivedFrom: {
      derivation: PAGING,
      from: [pipelineCopy(paging.origin), pipelineCopy(style.origin)],
    },
  };

  for (const role of style.request) writeRole(route, role, paged, scope);

  writePageHeaders(route, paged, scope);
}

function writeRole(route: DeriveWireRoute, role: Role, paged: Paged, scope: DeriveWireScope): void {
  if (role.role === "sort") {
    writeSort(route, role, paged, scope);

    return;
  }

  const place = role.in === "query" ? "query" : "header";
  const number = numberUse(role, paged.paging, route);

  deriveWireAddParam(
    route,
    place,
    {
      ...optional(role.name, number ?? positionUse(role, paged.paging), paged),
      ...(number === undefined ? {} : { wire: NUMBER_QUERY_WIRE }),
    },
    scope,
  );
}

// The integer roles with their bounds; undefined for a text role.
function numberUse(
  role: Role,
  paging: IrWriter.Paging,
  route: DeriveWireRoute,
): IrWriter.TypeUse | undefined {
  switch (role.role) {
    case "page":
      return integerUse(role.base ?? DEFAULT_PAGE_BASE);
    case "offset":
      return integerUse(0);
    case "limit":
      return limitUse(paging, route);
    default:
      return undefined;
  }
}

function limitUse(paging: IrWriter.Paging, route: DeriveWireRoute): IrWriter.ScalarTypeUse {
  if (paging.maxLimit === undefined)
    throw new Error(
      `tree.nodes wrote no maxLimit on the paged list '${route.id}', whose style has a limit`,
    );

  return integerUse(1, paging.overLimit === "reject" ? paging.maxLimit : undefined);
}

function positionUse(role: Role, paging: IrWriter.Paging): IrWriter.TypeUse {
  if (role.role === "since" && paging.token === "instant")
    return { kind: "scalar", type: "string", format: "date-time", refinements: {} };

  return DERIVE_WIRE_STRING_USE;
}

function integerUse(minimum: number, maximum?: number): IrWriter.ScalarTypeUse {
  return {
    kind: "scalar",
    type: "integer",
    refinements: {
      minimum: String(minimum),
      ...(maximum === undefined ? {} : { maximum: String(maximum) }),
    },
  };
}

// No sort parameter on a list that sorts by nothing.
function writeSort(route: DeriveWireRoute, role: Role, paged: Paged, scope: DeriveWireScope): void {
  const keys = paged.paging.sortKeys.map((sortKey) => sortKey.key);

  if (keys.length === 0) return;

  const place = role.in === "query" ? "query" : "header";
  const add = (derived: DeriveWireDerived): void =>
    deriveWireAddParam(route, place, derived, scope);
  const list = (explode: boolean): DeriveWireDerived => ({
    ...optional(role.name, { kind: "array", items: DERIVE_WIRE_STRING_USE }, paged),
    wire: { kind: "list", style: "form", explode, brackets: false },
  });

  switch (role.style ?? "signed") {
    case "signed":
      add(list(false));

      return;
    case "pair":
      add(list(true));

      return;
    case "keyed":
      for (const key of keys)
        add(optional(role.name.replace(KEY_PLACEHOLDER, key), DERIVE_WIRE_STRING_USE, paged));

      return;
    case "split": {
      if (role.direction === undefined)
        throw new Error(
          `tree.nodes wrote a split sort role without its direction on '${route.id}'`,
        );

      add(optional(role.name, DERIVE_WIRE_STRING_USE, paged));
      add(optional(role.direction, DERIVE_WIRE_STRING_USE, paged));
    }
  }
}

function writePageHeaders(route: DeriveWireRoute, paged: Paged, scope: DeriveWireScope): void {
  const { headers, links } = paged.style.response;
  const names = [...headers.map((header) => header.name), ...(links.length > 0 ? [LINK] : [])];

  if (names.length === 0) return;

  const responses = (route.operation.responses ?? []).filter(
    (response) => response.shape === "page",
  );

  if (responses.length === 0)
    throw new Error(`tree.nodes wrote no page response on the paged list '${route.id}'`);

  for (const response of responses)
    for (const name of names)
      deriveWireAddResponseHeader(
        route,
        response,
        optional(name, DERIVE_WIRE_STRING_USE, paged),
        undefined,
        scope,
      );
}

function optional(name: string, type: IrWriter.TypeUse, paged: Paged): DeriveWireDerived {
  return { name, type, required: false, derivedFrom: paged.derivedFrom };
}
