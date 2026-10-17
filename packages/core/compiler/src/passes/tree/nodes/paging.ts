import type { IrWriter, Origin } from "@seampact/spec/ir";
import { pipelineCopy } from "../../../pipeline/seam.js";
import { treeNodesError, treeNodesNodeOrigin } from "./diagnostics.js";
import type { TreeNodesSite } from "./fields.js";
import {
  type TreeNodesJson,
  treeNodesIsObject,
  treeNodesMember,
  treeNodesObjectOf,
  treeNodesPointer,
  treeNodesSetting,
  treeNodesWrittenConvention,
} from "./raw.js";

// The paging of a list (ADR 0002 sections 10 and 14, A31): the style the route names, `paging: none`, or
// `conventions.paging.default`; the limits from the route, else `conventions.paging`; the sort keys of `sortable`
// with their origins (their rights are access.rights'). A list with no style at all is a compile error naming both
// fixes (CHK-106).

const PAGING_NONE = "none";
const DEFAULT_OVER_LIMIT: IrWriter.OverLimitPolicy = "reject";
const OVER_LIMITS: readonly IrWriter.OverLimitPolicy[] = ["reject", "clamp"];
const TOKENS: readonly IrWriter.PagingToken[] = ["opaque", "instant"];
// ADR 0002 section 14: a changes-since token is opaque unless `token: instant` makes it a date-time.
const DEFAULT_TOKEN: IrWriter.PagingToken = "opaque";

const LIMIT_ROLE = "limit";
const SORT_ROLE = "sort";
const SINCE_ROLE = "since";

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
  isList: boolean,
  item: IrWriter.TypeUse | undefined,
  queryNames: readonly string[],
): IrWriter.Paging | undefined {
  if (!isList) {
    refuseOutsideList(site);

    return undefined;
  }

  const named = namedStyle(site);

  if (named === undefined) return undefined;

  const sortKeys = sortKeysOf(site, item);

  if (named.id === undefined) {
    refuseSortWithoutRole(site, sortKeys, "an unpaged list");

    return { overLimit: overLimitOf(site, named), sortKeys, origin: pipelineCopy(named.origin) };
  }

  const style = declaredStyle(site, named);

  if (style === undefined) return undefined;

  const roles = requestRoles(style);

  if (!roles.includes(SORT_ROLE)) refuseSortWithoutRole(site, sortKeys, `the style ${named.id}`);
  refuseTakenNames(site, named.id, style, queryNames);
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

    if (written === PAGING_NONE)
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

function declaredStyle(site: TreeNodesSite, named: NamedStyle): TreeNodesJson | undefined {
  const pagings = site.context.raw.merged.pagings;
  const id = named.id ?? "";
  const style = treeNodesIsObject(pagings) && Object.hasOwn(pagings, id) ? pagings[id] : undefined;

  if (style !== undefined) return style;

  site.once(
    `paging-unknown:${named.origin.layer}#${named.origin.pointer}`,
    treeNodesError({
      rule: "paging-unknown",
      origin: treeNodesNodeOrigin(named.origin),
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
  queryNames: readonly string[],
): void {
  const request = treeNodesMember(style, "request");

  if (!treeNodesIsObject(request)) return;

  for (const [role, place] of Object.entries(request)) {
    const name = treeNodesMember(place, "query");

    if (typeof name !== "string" || !queryNames.includes(name)) continue;

    site.context.report(
      treeNodesError({
        rule: "paging-param",
        origin: treeNodesNodeOrigin(site.node.origin),
        message: `The query field ${name} of ${site.operationId} is also the ${role} parameter of the paging style ${id}.`,
        fix: `Rename the query field ${name}, or use another paging style.`,
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
function limitsOf(
  site: TreeNodesSite,
  named: NamedStyle,
  roles: readonly string[],
): Limits | undefined {
  const conventions = site.context.conventions;
  const maxLimit =
    numberOf(treeNodesMember(named.settings, "maxLimit")) ??
    numberOf(conventions.get("paging.maxLimit")?.value);
  const defaultLimit =
    numberOf(treeNodesMember(named.settings, "defaultLimit")) ??
    numberOf(treeNodesWrittenConvention(site.context, "paging.defaultLimit")?.value) ??
    maxLimit;
  const token = tokenOf(site, named, roles);

  if (roles.includes(LIMIT_ROLE) && maxLimit === undefined)
    return reportLimit(site, named, "its limit role needs a maxLimit", "Set maxLimit");

  if (defaultLimit === undefined)
    return reportLimit(
      site,
      named,
      "a style without a limit role needs a defaultLimit",
      "Set defaultLimit",
    );

  if (maxLimit !== undefined && defaultLimit > maxLimit)
    return reportLimit(
      site,
      named,
      `its defaultLimit ${defaultLimit} is above its maxLimit ${maxLimit}`,
      "Lower defaultLimit to maxLimit or less",
    );

  return {
    ...(maxLimit === undefined ? {} : { maxLimit }),
    defaultLimit,
    overLimit: overLimitOf(site, named),
    ...(token === undefined ? {} : { token }),
  };
}

function reportLimit(site: TreeNodesSite, named: NamedStyle, why: string, fix: string): undefined {
  site.context.report(
    treeNodesError({
      rule: "paging-limit",
      origin: treeNodesNodeOrigin(named.onRoute ? named.origin : site.node.origin),
      message: `The list ${site.operationId} pages with ${named.id}, but ${why}.`,
      fix: `${fix} on the route's paging or in conventions.paging.`,
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
