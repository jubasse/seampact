import type { IrWriter, Origin } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import { TREE_NODES_DEFAULT_SORT_STYLE } from "./pagings.js";
import {
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesObjectOf,
  treeNodesPointer,
  treeNodesSetting,
  treeNodesWrittenConvention,
} from "./raw.js";
import { TREE_NODES_PAGING_NONE, treeNodesIsList } from "./responses.js";

// The paging of a list (ADR 0002 sections 10 and 14, A31): the style the route names, `paging: none`, or
// `conventions.paging.default`; the limits from the route, else `conventions.paging`; the sort keys of `sortable`
// with their origins (their rights are access.rights'). A list with no style at all is a compile error naming both
// fixes (CHK-106).

const DEFAULT_OVER_LIMIT: IrWriter.OverLimitPolicy = "reject";
const OVER_LIMITS: readonly IrWriter.OverLimitPolicy[] = ["reject", "clamp"];
const TOKENS: readonly IrWriter.PagingToken[] = ["opaque", "instant"];
// ADR 0002 section 14: a changes-since token is opaque unless `token: instant` makes it a date-time.
const DEFAULT_TOKEN: IrWriter.PagingToken = "opaque";

const LIMIT_ROLE = "limit";
const SORT_ROLE = "sort";
const SINCE_ROLE = "since";

// A signed sort list splits its items on `,` and reads a leading `-` as descending (ADR 0002 section 14).
const SIGNED_SORT_STYLE: IrWriter.PagingParamStyle = "signed";
const SIGNED_LIST_SEPARATOR = ",";
const SIGNED_DESCENDING_PREFIX = "-";

/** The paging style a list uses, as written: its id, its route settings and where it is named. */
interface NamedStyle {
  readonly id: string | undefined;
  readonly settings: TreeNodesJson | undefined;
  readonly origin: Origin;
  /** True when the route writes `paging`, false when it comes from `conventions.paging.default`. */
  readonly onRoute: boolean;
}

/** The members of a list's paging the route and the conventions give. */
interface Limits {
  readonly maxLimit?: number;
  readonly defaultLimit?: number;
  readonly overLimit: IrWriter.OverLimitPolicy;
  readonly token?: IrWriter.PagingToken;
}

/**
 * The paging of a list operation, undefined when the list has no style (reported). A route that is no list and
 * writes `paging` or `sortable` is refused.
 */
export function treeNodesPaging(
  site: TreeNodesSite,
  responses: readonly IrWriter.Response[],
  query: readonly IrWriter.Param[],
): IrWriter.Paging | undefined {
  if (!treeNodesIsList(site.node)) {
    refuseOutsideList(site);

    return undefined;
  }

  const named = namedStyle(site);

  if (named === undefined) return undefined;

  const item = responses.find((response) => response.body !== undefined)?.body;
  const sortKeys = sortKeysOf(site, item);

  if (named.id === undefined) {
    refuseSortWithoutRole(site, sortKeys, "an unpaged list");

    return { overLimit: overLimitOf(site, named), sortKeys, origin: pipelineCopy(named.origin) };
  }

  const style = declaredStyle(site, named.id, named.origin);

  if (style === undefined) return undefined;

  const roles = requestRoles(style);

  if (!roles.includes(SORT_ROLE)) refuseSortWithoutRole(site, sortKeys, `the style ${named.id}`);
  else if (sortStyleOf(style) === SIGNED_SORT_STYLE) refuseUnsignableKeys(site, named.id, sortKeys);
  refuseTakenNames(site, named.id, style, query);
  const limits = limitsOf(site, named, roles);

  return limits === undefined
    ? undefined
    : { style: named.id, ...limits, sortKeys, origin: pipelineCopy(named.origin) };
}

function refuseOutsideList(site: TreeNodesSite): void {
  for (const member of ["paging", "sortable"]) {
    if (treeNodesSetting(site.node, member) === undefined) continue;
    const pointer = `${site.node.pointer}/${member}`;

    site.context.report(
      treeNodesError({
        rule: "paging-list",
        origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
        message: `The operation ${site.operationId} writes ${member}, but it is no list.`,
        fix: `Remove ${member}, or make the route a list (the list op, or item instead of output).`,
      }),
    );
  }
}

// The style the route names (`cursor`, `{ cursor: { maxLimit } }`, `none`), else the convention's.
function namedStyle(site: TreeNodesSite): NamedStyle | undefined {
  const written = treeNodesSetting(site.node, "paging");
  const pointer = `${site.node.pointer}/paging`;

  if (written !== undefined) {
    const origin = site.context.origin(pointer);

    if (origin === undefined) throw new Error(`the raw tree has no origin for ${pointer}`);

    if (written === TREE_NODES_PAGING_NONE)
      return { id: undefined, settings: undefined, origin, onRoute: true };

    if (typeof written === "string")
      return { id: written, settings: undefined, origin, onRoute: true };

    const [id] = treeNodesIsObject(written) ? Object.keys(written) : [];

    if (id === undefined) throw new Error(`the paging at ${pointer} names no style`);

    return { id, settings: treeNodesMember(written, id), origin, onRoute: true };
  }

  const reading = site.context.conventions.get("paging.default");

  if (typeof reading?.value === "string" && reading.origin !== undefined)
    return { id: reading.value, settings: undefined, origin: reading.origin, onRoute: false };

  site.context.report(
    treeNodesError({
      rule: "paging-style",
      origin: treeNodesNodeOrigin(site.node.origin),
      message: `The list ${site.operationId} names no paging style, and conventions.paging.default sets none.`,
      fix: "Declare a style in pagings and name it in paging (or conventions.paging.default), or apply a format pack that provides one; paging: none serves the whole list.",
    }),
  );

  return undefined;
}

function declaredStyle(site: TreeNodesSite, id: string, origin: Origin): TreeNodesJson | undefined {
  const pagings = site.context.raw.merged.pagings;
  const style = treeNodesIsObject(pagings) && Object.hasOwn(pagings, id) ? pagings[id] : undefined;

  if (style !== undefined) return style;

  site.once(
    `paging-unknown:${origin.layer}#${origin.pointer}`,
    treeNodesError({
      rule: "paging-unknown",
      origin: treeNodesNodeOrigin(origin),
      message: `The paging style ${id} of ${site.operationId} is not declared in pagings.`,
      fix: `Declare ${id} in pagings, or name a declared style.`,
    }),
  );

  return undefined;
}

const requestRoles = (style: TreeNodesJson): string[] => {
  const request = treeNodesMember(style, "request");

  return treeNodesIsObject(request) ? Object.keys(request) : [];
};

// ADR 0002 section 14: a request name already used by the route's `query` is a compile error naming the style.
function refuseTakenNames(
  site: TreeNodesSite,
  id: string,
  style: TreeNodesJson,
  query: readonly IrWriter.Param[],
): void {
  const request = treeNodesMember(style, "request");

  if (!treeNodesIsObject(request)) return;

  for (const [role, place] of Object.entries(request)) {
    const name = treeNodesMember(place, "query");

    const taken = query.find((param) => param.name === name);

    if (taken === undefined) continue;

    site.context.report(
      treeNodesError({
        rule: "paging-param",
        origin: treeNodesNodeOrigin(taken.origin ?? site.node.origin),
        message: `The query field ${taken.name} of ${site.operationId} is also the ${role} parameter of the paging style ${id}.`,
        fix: `Rename the query field ${taken.name}, or use another paging style.`,
        related: requestRelated(site, id, role),
      }),
    );
  }
}

function requestRelated(site: TreeNodesSite, id: string, role: string) {
  const origin = site.context.origin(treeNodesPointer("/pagings", id, "request", role));

  return origin === undefined
    ? []
    : [{ origin: treeNodesNodeOrigin(origin), message: `the ${role} role of ${id}` }];
}

function sortKeysOf(site: TreeNodesSite, item: IrWriter.TypeUse | undefined): IrWriter.SortKey[] {
  const written = treeNodesSetting(site.node, "sortable");

  if (!Array.isArray(written)) return [];

  const schema = treeNodesObjectOf(site.draft, item);

  return written.flatMap((entry, index) => {
    const key = typeof entry === "string" ? entry : treeNodesMember(entry, "key");
    const pointer = `${site.node.pointer}/sortable/${index}`;
    const origin = site.context.origin(pointer);

    if (typeof key !== "string" || origin === undefined)
      throw new Error(`the sort key at ${pointer} has no key or origin`);

    if (schema !== undefined && !schema.properties.some((property) => property.name === key))
      reportUnknownKey(site, key, schema.id, origin);

    return [{ key, origin: pipelineCopy(origin) }];
  });
}

function reportUnknownKey(site: TreeNodesSite, key: string, schema: string, origin: Origin): void {
  site.context.report(
    treeNodesError({
      rule: "sort-key",
      origin: treeNodesNodeOrigin(origin),
      message: `The sort key ${key} of ${site.operationId} is not a property of its item ${schema}.`,
      fix: `Name a property of ${schema}, or declare ${key} on it.`,
    }),
  );
}

const sortStyleOf = (style: TreeNodesJson): TreeNodesJson =>
  treeNodesMember(treeNodesMember(treeNodesMember(style, "request"), SORT_ROLE), "style") ??
  TREE_NODES_DEFAULT_SORT_STYLE;

// A key holding the separator or starting with the descending sign could not be read back from a signed list.
function refuseUnsignableKeys(
  site: TreeNodesSite,
  styleId: string,
  sortKeys: readonly IrWriter.SortKey[],
): void {
  for (const { key, origin } of sortKeys) {
    if (!key.includes(SIGNED_LIST_SEPARATOR) && !key.startsWith(SIGNED_DESCENDING_PREFIX)) continue;

    site.context.report(
      treeNodesError({
        rule: "sort-key-signed",
        origin: treeNodesNodeOrigin(origin ?? site.node.origin),
        message: `The sort key ${key} of ${site.operationId} holds a ',' or starts with '-', which the signed sort style ${styleId} cannot send.`,
        fix: `Rename ${key}, or use a paging style whose sort role is pair, keyed or split.`,
      }),
    );
  }
}

function refuseSortWithoutRole(
  site: TreeNodesSite,
  sortKeys: readonly IrWriter.SortKey[],
  what: string,
): void {
  if (sortKeys.length === 0) return;
  const pointer = `${site.node.pointer}/sortable`;

  site.context.report(
    treeNodesError({
      rule: "paging-sort",
      origin: treeNodesNodeOrigin(site.context.origin(pointer) ?? site.node.origin),
      message: `The list ${site.operationId} declares sort keys, but ${what} has no sort role to send them.`,
      fix: "Remove sortable, or use a paging style with a sort role.",
    }),
  );
}

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

function overLimitOf(site: TreeNodesSite, named: NamedStyle): IrWriter.OverLimitPolicy {
  const written =
    treeNodesMember(named.settings, "overLimit") ??
    site.context.conventions.get("paging.overLimit")?.value;

  return OVER_LIMITS.find((policy) => policy === written) ?? DEFAULT_OVER_LIMIT;
}

// ADR 0002 sections 13 and 14: `maxLimit` is required for a style with a `limit` role, `defaultLimit` is the
// limit of a request that sends none (the `maxLimit` by default) and the page size of a style without `limit`.
// Each limit comes from the route, else `conventions.paging`. A convention default above the route's `maxLimit` is
// lowered to it; a route default above the effective `maxLimit`, or a convention pair at odds, is refused.
function limitsOf(
  site: TreeNodesSite,
  named: NamedStyle,
  roles: readonly string[],
): Limits | undefined {
  const route = writtenLimits(named.settings);
  const conventions = conventionLimits(site);
  const maxLimit = route.maxLimit ?? conventions.maxLimit?.value;
  const writtenDefault = route.defaultLimit ?? conventions.defaultLimit?.value;
  const token = tokenOf(site, named, roles);

  if (roles.includes(LIMIT_ROLE) && maxLimit === undefined)
    return reportMissingLimit(site, named, "its limit role needs a maxLimit", "Set maxLimit");

  const inheritedDefault = writtenDefault ?? maxLimit;

  if (inheritedDefault === undefined)
    return reportMissingLimit(
      site,
      named,
      "a style without a limit role needs a defaultLimit",
      "Set defaultLimit",
    );

  const routeContradiction = aboveMaxLimit(route.defaultLimit, maxLimit);

  if (routeContradiction !== undefined)
    return reportRouteContradiction(site, named, routeContradiction);

  const { defaultLimit: conventionDefault, maxLimit: conventionMax } = conventions;

  if (
    conventionDefault !== undefined &&
    conventionMax !== undefined &&
    aboveMaxLimit(conventionDefault.value, conventionMax.value) !== undefined
  )
    return reportConventionContradiction(site, conventionDefault, conventionMax);

  const defaultLimit =
    maxLimit === undefined ? inheritedDefault : Math.min(inheritedDefault, maxLimit);

  return {
    ...(maxLimit === undefined ? {} : { maxLimit }),
    defaultLimit,
    overLimit: overLimitOf(site, named),
    ...(token === undefined ? {} : { token }),
  };
}

interface RouteLimits {
  readonly maxLimit?: number;
  readonly defaultLimit?: number;
}

interface ConventionLimit {
  readonly value: number;
  readonly origin: Origin;
}

interface ConventionLimits {
  readonly maxLimit?: ConventionLimit;
  readonly defaultLimit?: ConventionLimit;
}

function writtenLimits(settings: TreeNodesJson | undefined): RouteLimits {
  const maxLimit = numberOf(treeNodesMember(settings, "maxLimit"));
  const defaultLimit = numberOf(treeNodesMember(settings, "defaultLimit"));

  return {
    ...(maxLimit === undefined ? {} : { maxLimit }),
    ...(defaultLimit === undefined ? {} : { defaultLimit }),
  };
}

// `conventions.paging.defaultLimit` reads `maxLimit` when unwritten, so only a written one counts as a default.
function conventionLimits(site: TreeNodesSite): ConventionLimits {
  const maxLimit = conventionLimit(site.context.conventions.get("paging.maxLimit"));
  const defaultLimit = conventionLimit(
    treeNodesWrittenConvention(site.context, "paging.defaultLimit"),
  );

  return {
    ...(maxLimit === undefined ? {} : { maxLimit }),
    ...(defaultLimit === undefined ? {} : { defaultLimit }),
  };
}

function conventionLimit(
  reading: { readonly value: unknown; readonly origin?: Origin | undefined } | undefined,
): ConventionLimit | undefined {
  const value = numberOf(reading?.value);

  return value === undefined || reading?.origin === undefined
    ? undefined
    : { value, origin: reading.origin };
}

interface LimitPair {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

function aboveMaxLimit(
  defaultLimit: number | undefined,
  maxLimit: number | undefined,
): LimitPair | undefined {
  if (defaultLimit === undefined || maxLimit === undefined || defaultLimit <= maxLimit)
    return undefined;

  return { defaultLimit, maxLimit };
}

// A limit missing from a style the conventions name is one fault, reported once at `conventions.paging.default`.
function reportMissingLimit(
  site: TreeNodesSite,
  named: NamedStyle,
  why: string,
  fix: string,
): undefined {
  const diagnostic = treeNodesError({
    rule: "paging-limit",
    origin: treeNodesNodeOrigin(named.origin),
    message: named.onRoute
      ? `The list ${site.operationId} pages with ${named.id}, but ${why}.`
      : `The paging style ${named.id} of conventions.paging.default is used by lists, but ${why}.`,
    fix: `${fix} on the route's paging or in conventions.paging.`,
  });

  if (named.onRoute) site.context.report(diagnostic);
  else site.once(`paging-limit:${named.origin.layer}#${named.origin.pointer}`, diagnostic);

  return undefined;
}

function reportRouteContradiction(
  site: TreeNodesSite,
  named: NamedStyle,
  { defaultLimit, maxLimit }: LimitPair,
): undefined {
  site.context.report(
    treeNodesError({
      rule: "paging-limit",
      origin: treeNodesNodeOrigin(named.origin),
      message: `The list ${site.operationId} pages with ${named.id}, but its defaultLimit ${defaultLimit} is above its maxLimit ${maxLimit}.`,
      fix: "Lower defaultLimit on the route's paging to its maxLimit or less.",
    }),
  );

  return undefined;
}

function reportConventionContradiction(
  site: TreeNodesSite,
  defaultLimit: ConventionLimit,
  maxLimit: ConventionLimit,
): undefined {
  site.once(
    `paging-limit:${defaultLimit.origin.layer}#${defaultLimit.origin.pointer}`,
    treeNodesError({
      rule: "paging-limit",
      origin: treeNodesNodeOrigin(defaultLimit.origin),
      message: `The conventions.paging defaultLimit ${defaultLimit.value} is above its maxLimit ${maxLimit.value}.`,
      fix: "Lower conventions.paging.defaultLimit to its maxLimit or less.",
      related: [
        { origin: treeNodesNodeOrigin(maxLimit.origin), message: "conventions.paging.maxLimit" },
      ],
    }),
  );

  return undefined;
}

// `token` belongs to a style with a `since` role only.
function tokenOf(
  site: TreeNodesSite,
  named: NamedStyle,
  roles: readonly string[],
): IrWriter.PagingToken | undefined {
  const written = treeNodesMember(named.settings, "token");
  const token = TOKENS.find((candidate) => candidate === written);

  if (roles.includes(SINCE_ROLE)) return token ?? DEFAULT_TOKEN;

  if (written === undefined) return undefined;

  site.context.report(
    treeNodesError({
      rule: "paging-token",
      origin: treeNodesNodeOrigin(named.origin),
      message: `The list ${site.operationId} sets a token, but its style ${named.id} has no since role.`,
      fix: "Remove token, or use a style with a since role.",
    }),
  );

  return undefined;
}
