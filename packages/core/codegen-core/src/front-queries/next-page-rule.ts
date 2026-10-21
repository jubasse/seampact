import { type ContractIR, isKnownVariant, type Operation, type Template } from "@seampact/spec/ir";
import { pageBodyTemplate, positionRoleOf, templateSlots } from "../node-server/paging-entry.js";

// How an infinite query builds its next page's request from the page facts the client read (ADR 0021 "Paged
// lists"): the request member that carries the position, the limit, and the facts that say whether a page follows.

/** Where a request role sits in the client's request: a query parameter, or a header by its lower-case key. */
export interface RequestMember {
  readonly in: "query" | "header";
  readonly key: string;
}

/** The facts that tell a page or an offset list that a page follows, in the order the runtime reads them. */
export const NEXT_PAGE_EVIDENCE = ["more", "totalPages", "total", "next"] as const;

export type NextPageEvidence = (typeof NEXT_PAGE_EVIDENCE)[number];

export type NextPageRule =
  | { readonly position: "cursor"; readonly member: RequestMember }
  | {
      readonly position: "page" | "offset";
      readonly member: RequestMember;
      readonly limit?: RequestMember;
      readonly defaultLimit?: number;
      // The first page's number; 0 for an offset.
      readonly base: number;
      readonly evidence: readonly NextPageEvidence[];
    };

/** The rule of a paged operation, or why it gets no infinite query. */
export type NextPageOutcome =
  | { readonly status: "ruled"; readonly rule: NextPageRule }
  | { readonly status: "skipped"; readonly reason: string };

const LIMIT_ROLE = "limit";
const NEXT_CURSOR_ROLE = "nextCursor";
const NEXT_LINK_ROLE = "next";
const QUERY_PLACEMENT = "query";
const HEADER_PLACEMENT = "header";
const OFFSET_BASE = 0;
const DEFAULT_PAGE_BASE = 1;

/** The next-page rule of a paged operation's style; the caller checks that the operation has a style. */
export function nextPageRuleOf(ir: ContractIR, operation: Operation): NextPageOutcome {
  const styleId = operation.paging?.style;
  const style =
    styleId !== undefined && Object.hasOwn(ir.pagings, styleId) ? ir.pagings[styleId] : undefined;

  if (style === undefined) {
    return { status: "skipped", reason: `its paging style '${styleId ?? ""}' is not declared` };
  }

  if (style.position === "since") {
    return {
      status: "skipped",
      reason: "its 'since' style resumes from a point in time, with no next page to load",
    };
  }

  const positionRole = positionRoleOf(style);
  const member = positionRole === undefined ? undefined : requestMember(positionRole);

  if (positionRole === undefined || member === undefined) {
    return {
      status: "skipped",
      reason: `its style '${style.id}' has no position parameter in the query or a header`,
    };
  }

  const roles = responseRoles(ir, operation);

  if (style.position === "cursor") {
    const nextCursor =
      roles.has(NEXT_CURSOR_ROLE) || (roles.has(NEXT_LINK_ROLE) && member.in === QUERY_PLACEMENT);

    return nextCursor
      ? { status: "ruled", rule: { position: "cursor", member } }
      : {
          status: "skipped",
          reason: `its style '${style.id}' gives no next cursor (no 'nextCursor' and no 'next' link)`,
        };
  }

  const position = pagedPosition(style.position);

  if (position === undefined) {
    return {
      status: "skipped",
      reason: `its style '${style.id}' has the position kind '${style.position}', which this version does not know`,
    };
  }

  const limitRole = style.request.find((role) => role.role === LIMIT_ROLE);
  const limit = limitRole === undefined ? undefined : requestMember(limitRole);
  const defaultLimit = operation.paging?.defaultLimit;
  const knowsLimit = limit !== undefined || defaultLimit !== undefined;
  const evidence = NEXT_PAGE_EVIDENCE.filter(
    (fact) => roles.has(fact) && (fact !== "total" || knowsLimit),
  );

  if (evidence.length === 0) {
    return {
      status: "skipped",
      reason: `its style '${style.id}' gives no next-page fact ('more', 'totalPages', 'total' with a limit, or a 'next' link)`,
    };
  }

  return {
    status: "ruled",
    rule: {
      position,
      member,
      ...(limit === undefined ? {} : { limit }),
      ...(defaultLimit === undefined ? {} : { defaultLimit }),
      base: position === "offset" ? OFFSET_BASE : (positionRole.base ?? DEFAULT_PAGE_BASE),
      evidence,
    },
  };
}

function pagedPosition(position: string): "page" | "offset" | undefined {
  if (position === "page") return "page";

  return position === "offset" ? "offset" : undefined;
}

function requestMember(role: {
  readonly in: string;
  readonly name: string;
}): RequestMember | undefined {
  if (role.in === QUERY_PLACEMENT) return { in: "query", key: role.name };

  if (role.in === HEADER_PLACEMENT) return { in: "header", key: role.name.toLowerCase() };

  return undefined;
}

// The response roles a page carries: the slots of its body, meta and headers, and its link relations' roles.
function responseRoles(ir: ContractIR, operation: Operation): ReadonlySet<string> {
  const styleId = operation.paging?.style;
  const style =
    styleId !== undefined && Object.hasOwn(ir.pagings, styleId) ? ir.pagings[styleId] : undefined;
  const body = pageBodyTemplate(ir, operation);
  const templates = [
    ...(body === undefined ? [] : [body]),
    ...(style?.response.meta.map((member) => member.value) ?? []),
    ...(style?.response.headers.map((header) => header.value) ?? []),
  ];

  return new Set([
    ...templates.flatMap(roleSlots),
    ...(style?.response.links.map((link) => link.role) ?? []),
  ]);
}

// A header written as text around a slot carries that slot too.
function roleSlots(template: Template): string[] {
  if (!isKnownVariant("Template", template) || template.kind !== "text") {
    return templateSlots(template);
  }

  return template.parts.flatMap((part) =>
    isKnownVariant("TextPart", part) && part.kind === "slot" ? [part.slot] : [],
  );
}
