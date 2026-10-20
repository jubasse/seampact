import {
  type ContractIR,
  isKnownVariant,
  type Operation,
  type PagingRequestRole,
  type PagingStyle,
  type Template,
} from "@seampact/spec/ir";
import { below, type IrLocation } from "../ir-location.js";
import {
  refuseInconsistentIr,
  refuseNotGeneratedYet,
  refuseUnknownValueAt,
} from "../located-refusals.js";
import type { Refusal } from "../refusal.js";
import { type SourceValue, template } from "./route-table-source.js";

// A list's paging style as the boundary renders it (the runtime's `PagingEntry`, ADR 0002 section 14): where the
// request carries the position and the limit, what the handler returns beside the items, and the page body, meta
// members, headers and `Link` relations the style writes from the response roles.

const API_LOCATION: IrLocation = { member: "" };
const LIMIT_ROLE = "limit";
const SORT_ROLE = "sort";
const AFTER_ROLE = "after";
const BEFORE_ROLE = "before";
const SIGNED_SORT_STYLE = "signed";
const QUERY_PLACEMENT = "query";
const DEFAULT_PAGE_BASE = 1;
const ITEMS_SLOT = "items";
const PAGE_SLOT = "page";

// The request role that carries each position kind; a cursor kind may carry it in `after` and `before` instead.
const POSITION_ROLES: Readonly<Record<string, string>> = {
  cursor: "cursor",
  page: "page",
  offset: "offset",
  since: "since",
};

// The page slots whose value is an array or an object, never a header value.
const STRUCTURED_PAGE_SLOTS: readonly string[] = [ITEMS_SLOT, "meta"];

const ABSENT_RENDERINGS: readonly string[] = ["omit", "null"];

// The slots a page template may write that the boundary fills: the response roles, the request path and status,
// and the format's `$meta`. `resource` and `collection` are not rendered yet.
const RENDERED_PAGE_SLOTS: readonly string[] = [
  "items",
  "nextCursor",
  "previousCursor",
  "more",
  "page",
  "offset",
  "limit",
  "from",
  "to",
  "total",
  "totalPages",
  "self",
  "first",
  "previous",
  "next",
  "last",
  "nextSince",
  "complete",
  "path",
  "status",
  "meta",
];

/** The paging entry of a paged list, undefined for an unpaged one or a style the boundary cannot render. */
export function pagingEntry(
  ir: ContractIR,
  operation: Operation,
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  const paging = operation.paging;

  // `paging: none` has no style: the list answers a bare array and takes no cursor or limit.
  if (paging === undefined || paging.style === undefined) return undefined;

  const style = Object.hasOwn(ir.pagings, paging.style) ? ir.pagings[paging.style] : undefined;

  if (style === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "paging.style.unresolved",
        `The paging style '${paging.style}' is not declared`,
        below(location, "paging", "style"),
      ),
    );

    return undefined;
  }

  const styleLocation = below(API_LOCATION, "pagings", style.id);
  const positionRole = positionRoleOf(style);

  if (positionRole === undefined) {
    refusals.push(refuseUnknownValueAt(below(styleLocation, "position"), style.position));

    return undefined;
  }

  const limit = style.request.find((role) => role.role === LIMIT_ROLE);
  const before = style.request.find((role) => role.role === BEFORE_ROLE);

  refuseRequestRoles(style, styleLocation, refusals);

  if (
    style.position !== "cursor" &&
    style.position !== "since" &&
    paging.defaultLimit === undefined
  ) {
    refusals.push(
      refuseInconsistentIr(
        "paging.defaultLimit.missing",
        `The ${style.position} list has no default limit`,
        below(location, "paging"),
      ),
    );
  }

  const body = pageBody(ir, operation, style, refusals);
  const responseLocation = below(styleLocation, "response");

  return {
    position: style.position,
    positionParam: positionRole.name,
    beforeParam: before?.name,
    base: positionRole.base ?? DEFAULT_PAGE_BASE,
    limitParam: limit?.name,
    defaultLimit: paging.defaultLimit,
    handlerResult: [...style.handlerResult],
    absent: absentRendering(style.absent, below(styleLocation, "absent"), refusals),
    body,
    meta: style.response.meta.map((member, index) =>
      pageTemplate(style, member, below(responseLocation, "meta", String(index)), refusals),
    ),
    headers: style.response.headers.map((header, index) =>
      pageHeaderTemplate(
        style,
        header,
        below(responseLocation, "headers", String(index)),
        refusals,
      ),
    ),
    links: style.response.links.map((link) => ({ rel: link.rel, role: link.role })),
  };
}

function positionRoleOf(style: PagingStyle): PagingRequestRole | undefined {
  const roleName = Object.hasOwn(POSITION_ROLES, style.position)
    ? POSITION_ROLES[style.position]
    : undefined;

  if (roleName === undefined) return undefined;

  const role = style.request.find((candidate) => candidate.role === roleName);

  if (role !== undefined || style.position !== "cursor") return role;

  return style.request.find((candidate) => candidate.role === AFTER_ROLE);
}

// The boundary reads the position and the limit from the query and builds page URLs by replacing them there.
function refuseRequestRoles(
  style: PagingStyle,
  styleLocation: IrLocation,
  refusals: Refusal[],
): void {
  style.request.forEach((role, index) => {
    const roleLocation = below(styleLocation, "request", String(index));

    if (role.in !== QUERY_PLACEMENT) {
      refusals.push(
        refuseNotGeneratedYet(
          role.role === SORT_ROLE ? "paging.sort.in" : "paging.request.in",
          `A paging '${role.role}' role in '${role.in}'`,
          roleLocation,
        ),
      );
    }

    if (role.role === SORT_ROLE && (role.style ?? SIGNED_SORT_STYLE) !== SIGNED_SORT_STYLE) {
      refusals.push(
        refuseNotGeneratedYet(
          "paging.sort.style",
          `The sort style '${role.style ?? ""}'`,
          below(roleLocation, "style"),
        ),
      );
    }
  });
}

/** The `absent` of a style or a format, as the runtime renders it. */
export function absentRendering(absent: string, location: IrLocation, refusals: Refusal[]): string {
  if (ABSENT_RENDERINGS.includes(absent)) return absent;

  refusals.push(refuseUnknownValueAt(location, absent));

  return "omit";
}

/** The page body a list answers: the style's own, or the format's page body, whose `$meta` the style's meta joins. */
export function pageBodyTemplate(ir: ContractIR, operation: Operation): Template | undefined {
  const styleId = operation.paging?.style;
  const style =
    styleId !== undefined && Object.hasOwn(ir.pagings, styleId) ? ir.pagings[styleId] : undefined;

  if (style?.response.body !== undefined) return style.response.body;

  return Object.hasOwn(ir.formats, operation.format)
    ? ir.formats[operation.format]?.success.page.body
    : undefined;
}

/** Where the page body of a list is written: the style's own body, or the format's page body. */
export function pageBodyLocation(ir: ContractIR, operation: Operation): IrLocation {
  const styleId = operation.paging?.style;
  const style =
    styleId !== undefined && Object.hasOwn(ir.pagings, styleId) ? ir.pagings[styleId] : undefined;

  if (style?.response.body !== undefined) {
    return below(API_LOCATION, "pagings", style.id, "response", "body");
  }

  return below(API_LOCATION, "formats", operation.format, "success", "page", "body");
}

function pageBody(
  ir: ContractIR,
  operation: Operation,
  style: PagingStyle,
  refusals: Refusal[],
): SourceValue {
  const body = pageBodyTemplate(ir, operation);
  const location = pageBodyLocation(ir, operation);

  if (body === undefined) {
    refusals.push(
      refuseInconsistentIr(
        "format.unresolved",
        `The format '${operation.format}' is not declared`,
        location,
      ),
    );

    return { kind: "slot", slot: ITEMS_SLOT, path: [] };
  }

  return pageTemplateValue(style, body, location, refusals);
}

function pageTemplate(
  style: PagingStyle,
  named: { readonly name: string; readonly value: Template },
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  return {
    name: named.name,
    value: pageTemplateValue(style, named.value, below(location, "value"), refusals),
  };
}

// A header is written as text: a template that renders an object or an array has no header value.
function pageHeaderTemplate(
  style: PagingStyle,
  header: { readonly name: string; readonly value: Template },
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  if (!isScalarTemplate(header.value)) {
    refusals.push(
      refuseNotGeneratedYet(
        "paging.response.header",
        `The header '${header.name}' of the paging style '${style.id}', written from an object or an array,`,
        below(location, "value"),
      ),
    );
  }

  return pageTemplate(style, header, location, refusals);
}

function isScalarTemplate(node: Template): boolean {
  if (!isKnownVariant("Template", node)) return false;

  switch (node.kind) {
    case "text":
      return true;
    case "literal":
      return node.value === null || typeof node.value !== "object";
    case "slot":
      return node.path.length > 0 || !STRUCTURED_PAGE_SLOTS.includes(node.slot);
    default:
      return false;
  }
}

function pageTemplateValue(
  style: PagingStyle,
  node: Template,
  location: IrLocation,
  refusals: Refusal[],
): SourceValue {
  // An offset kind has no page number of its own: its base is not declared.
  const unrenderedSlots = [...new Set(templateSlots(node))].filter(
    (slot) =>
      !RENDERED_PAGE_SLOTS.includes(slot) || (slot === PAGE_SLOT && style.position === "offset"),
  );

  if (unrenderedSlots.length > 0) {
    refusals.push(
      refuseNotGeneratedYet(
        "paging.response.slot",
        `The page slots ${unrenderedSlots.map((slot) => `'$${slot}'`).join(", ")} of the paging style '${style.id}'`,
        location,
      ),
    );
  }

  return template(node, location, refusals);
}

// The slots a template reads, nested members and `$as` included; `meta` is the format's, joined by the style.
export function templateSlots(node: Template): string[] {
  if (!isKnownVariant("Template", node)) return [];

  switch (node.kind) {
    case "slot":
      return [node.slot];
    case "each":
      return [node.of, ...templateSlots(node.as)];
    case "object":
      return node.members.flatMap((member) => templateSlots(member.value));
    case "array":
      return node.items.flatMap(templateSlots);
    default:
      return [];
  }
}

/** The members leading from a template to the slot it writes whole, undefined when no member path reaches it. */
export function slotPath(node: Template, slot: string): readonly string[] | undefined {
  if (!isKnownVariant("Template", node)) return undefined;

  if (node.kind === "slot") return node.slot === slot && node.path.length === 0 ? [] : undefined;

  if (node.kind !== "object") return undefined;

  for (const member of node.members) {
    if (!isKnownVariant("MemberName", member.name) || member.name.kind !== "text") continue;

    const rest = slotPath(member.value, slot);

    if (rest !== undefined) return [member.name.text, ...rest];
  }

  return undefined;
}
