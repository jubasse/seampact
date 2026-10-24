// The page a paged list answers (ADR 0002 section 14): the facts the handler returns beside the items, the ones the
// boundary reads from the request, and the body, headers and `Link` relations the paging style writes from them.
// Copied into the generated tree as is.
import type { CheckState } from "./access-checks.js";
import { isPlainObject, renderTemplate, unexpectedError } from "./contract-error.js";
import type { PagingEntry } from "./contract-route.js";
import { withoutQueryMembers, withQueryMember } from "./wire-decoding.js";

// The type of each member a handler returns beside the items; only the cursors may be absent, at either end.
const HANDLER_FACT_TYPES: Readonly<Record<string, "string" | "number" | "boolean">> = {
  nextCursor: "string",
  previousCursor: "string",
  total: "number",
  more: "boolean",
  nextSince: "string",
  complete: "boolean",
};
const OPTIONAL_HANDLER_FACTS: readonly string[] = ["nextCursor", "previousCursor"];
const MORE_FACT = "more";
const TOTAL_FACT = "total";
const FIRST_OFFSET = 0;

/** A handler's page: its items, and the members its paging style asks for beside them. */
export interface HandlerPage {
  readonly items: readonly unknown[];
  readonly facts: Readonly<Record<string, unknown>>;
}

/** The page the handler returned, checked against its paging style; a missing or mistyped member is a 500. */
export function handlerPage(state: CheckState, handlerBody: unknown): HandlerPage {
  const paging = state.route.paging;

  if (!isPlainObject(handlerBody) || !Array.isArray(handlerBody.items) || paging === undefined) {
    throw unexpectedError(
      state.route,
      new Error(`the handler of '${state.route.id}' returned no page { items }`),
    );
  }

  const facts: Record<string, unknown> = {};

  for (const member of paging.handlerResult) {
    const value = handlerBody[member];

    if (value === undefined && OPTIONAL_HANDLER_FACTS.includes(member)) continue;

    if (typeof value !== HANDLER_FACT_TYPES[member]) {
      throw unexpectedError(
        state.route,
        new Error(
          `the handler of '${state.route.id}' returned a page whose '${member}' is not a ${HANDLER_FACT_TYPES[member] ?? "known member"}`,
        ),
      );
    }

    if (member === TOTAL_FACT && !isRecordCount(value)) {
      throw unexpectedError(
        state.route,
        new Error(
          `the handler of '${state.route.id}' returned a page whose 'total' is not a non-negative integer`,
        ),
      );
    }

    facts[member] = value;
  }

  return { items: handlerBody.items, facts };
}

/** The page body and the headers its style writes, from the projected items and the request's position. */
export function renderedPage(
  state: CheckState,
  input: unknown,
  page: HandlerPage,
  projectedItems: readonly unknown[],
  status: number,
): { readonly body: unknown; readonly headers: readonly [string, string][] } {
  const paging = state.route.paging;

  if (paging === undefined) {
    throw unexpectedError(state.route, new Error(`the route '${state.route.id}' has no paging`));
  }

  const slots: Record<string, unknown> = {
    ...pageSlots(state, paging, input, page),
    items: projectedItems,
    status,
    path: state.request.path,
  };

  slots.meta = renderedMeta(paging, slots);

  const headers: [string, string][] = [];

  for (const header of paging.headers) {
    const value = renderTemplate(header.value, slots, "omit");

    if (value === undefined || value === null) continue;

    if (typeof value === "object") {
      throw unexpectedError(
        state.route,
        new Error(`the page header '${header.name}' of '${state.route.id}' is not a text value`),
      );
    }

    headers.push([header.name.toLowerCase(), String(value)]);
  }

  const relations = paging.links.flatMap((link) =>
    typeof slots[link.role] === "string" ? [`<${slots[link.role]}>; rel="${link.rel}"`] : [],
  );

  if (relations.length > 0) headers.push(["link", relations.join(", ")]);

  return { body: renderTemplate(paging.body, slots, paging.absent), headers };
}

// The style's meta members, joined into the format's `$meta`; none leaves `$meta` without a value.
function renderedMeta(paging: PagingEntry, slots: Readonly<Record<string, unknown>>): unknown {
  if (paging.meta.length === 0) return undefined;

  return renderTemplate({ kind: "object", members: paging.meta }, slots, paging.absent);
}

// The response roles but the items: the handler's facts, the request's position and limit, and the page URLs.
function pageSlots(
  state: CheckState,
  paging: PagingEntry,
  input: unknown,
  page: HandlerPage,
): Record<string, unknown> {
  const query = isPlainObject(input) && isPlainObject(input.query) ? input.query : {};
  const limit = numberOrUndefined(
    paging.limitParam === undefined ? paging.defaultLimit : query[paging.limitParam],
  );
  const facts = page.facts;
  const total = numberOrUndefined(facts.total);
  const totalPages =
    total === undefined || limit === undefined ? undefined : Math.ceil(total / limit);
  const slots: Record<string, unknown> = {
    ...facts,
    limit,
    totalPages,
    self: pageUrl(withoutQueryMembers(state.request.rawQuery, [])),
  };

  if (paging.position === "page" || paging.position === "offset") {
    return {
      ...slots,
      ...numberedPageSlots(state, paging, query, page, limit, totalPages),
    };
  }

  return { ...slots, ...tokenPageSlots(state, paging, facts) };
}

// A page or offset position: the boundary counts the page, its records and the URLs from the request.
function numberedPageSlots(
  state: CheckState,
  paging: PagingEntry,
  query: Readonly<Record<string, unknown>>,
  page: HandlerPage,
  limit: number | undefined,
  totalPages: number | undefined,
): Record<string, unknown> {
  if (limit === undefined) {
    throw unexpectedError(state.route, new Error(`the list '${state.route.id}' has no limit`));
  }

  const isPagePosition = paging.position === "page";
  const sentPosition = numberOrUndefined(query[paging.positionParam]);
  const pageNumber = isPagePosition ? (sentPosition ?? paging.base) : undefined;
  const offset =
    pageNumber === undefined ? (sentPosition ?? FIRST_OFFSET) : (pageNumber - paging.base) * limit;
  const pageIndex = Math.floor(offset / limit);
  const nextOffset = offset + limit;
  const total = numberOrUndefined(page.facts.total);
  const hasNext = paging.handlerResult.includes(MORE_FACT)
    ? page.facts.more === true
    : total !== undefined && nextOffset < total;
  // The position value of the page at an index, as the request writes it.
  const positionAt = (index: number): string =>
    String(isPagePosition ? paging.base + index : index * limit);
  const urlWithPosition = (position: string): string =>
    pageUrl(withQueryMember(state.request.rawQuery, paging.positionParam, position));
  const urlAt = (index: number): string => urlWithPosition(positionAt(index));
  // An offset the client chose need not fall on a page start: the next page starts one limit further.
  const nextUrl = isPagePosition ? urlAt(pageIndex + 1) : urlWithPosition(String(nextOffset));
  const hasItems = page.items.length > 0;

  return {
    page: pageNumber,
    offset,
    from: hasItems ? offset + 1 : undefined,
    to: hasItems ? offset + page.items.length : undefined,
    first: urlAt(0),
    previous: offset > FIRST_OFFSET ? pagePreviousUrl(state, paging, offset, limit) : undefined,
    next: hasNext ? nextUrl : undefined,
    last: totalPages === undefined ? undefined : urlAt(Math.max(totalPages - 1, 0)),
  };
}

// An offset between two page starts goes back one limit, never below the first record.
function pagePreviousUrl(
  state: CheckState,
  paging: PagingEntry,
  offset: number,
  limit: number,
): string {
  const previousOffset = Math.max(offset - limit, FIRST_OFFSET);
  const position =
    paging.position === "page" ? paging.base + Math.floor(previousOffset / limit) : previousOffset;

  return pageUrl(withQueryMember(state.request.rawQuery, paging.positionParam, String(position)));
}

// A cursor or since position: the URLs carry the tokens the handler returned.
function tokenPageSlots(
  state: CheckState,
  paging: PagingEntry,
  facts: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const positionParams = [
    paging.positionParam,
    ...(paging.beforeParam === undefined ? [] : [paging.beforeParam]),
  ];
  const withoutPosition = withoutQueryMembers(state.request.rawQuery, positionParams);
  const urlWith = (param: string, token: unknown): string | undefined =>
    typeof token === "string" ? pageUrl(withQueryMember(withoutPosition, param, token)) : undefined;

  if (paging.position === "since") {
    return {
      first: pageUrl(withoutPosition),
      next: urlWith(paging.positionParam, facts.nextSince),
    };
  }

  return {
    first: pageUrl(withoutPosition),
    next: urlWith(paging.positionParam, facts.nextCursor),
    previous: urlWith(paging.beforeParam ?? paging.positionParam, facts.previousCursor),
  };
}

// A query-only reference (RFC 3986): it resolves against the URL the client called, so it keeps a path prefix a
// reverse proxy stripped. An empty query is `?`, since an empty reference would keep the called query.
function pageUrl(query: string): string {
  return `?${query}`;
}

function isRecordCount(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
