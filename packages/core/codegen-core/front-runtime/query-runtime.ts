// The front runtime the generated queries call (ADR 0021 "The shared query plan and front runtime"), copied as is
// beside them: it normalises a request into a key, builds the next page's request from the page facts, holds one
// idempotency key per mutation attempt chain, combines the abort signals, turns a client result's headers into a
// plain record and a call's outcome into the plain values a store keeps. It imports no Node built-in and no framework.

/** Response headers as a plain record of lower-case names: a `Headers` object is not serialisable. */
export type PlainHeaders = Readonly<Record<string, string>>;

/** A client result whose `headers` is a plain record. */
export type WithPlainHeaders<Result> = Result extends { readonly headers: Headers }
  ? Omit<Result, "headers"> & { readonly headers: PlainHeaders }
  : Result;

/** A client result: a success, a declared error or an unexpected answer, each with its headers. */
export interface ClientResult {
  readonly ok: boolean;
  readonly headers: Headers;
}

/** The success members of a client result. */
export type SuccessOf<Result> = Extract<Result, { readonly ok: true }>;

/** The declared errors and the unexpected answer of a client result. */
export type FailureOf<Result> = Exclude<Result, { readonly ok: true }>;

/** The request part of a query key: the caller's request without the headers the client fills. */
export type KeyRequest = Readonly<Record<string, unknown>> | undefined;

/** Where a request role sits in the client's request (the query plan's `RequestMember`). */
export interface RequestMember {
  readonly in: "query" | "header";
  readonly key: string;
}

/** How an infinite query builds its next page's request (the query plan's `NextPageRule`). */
export type NextPageRule =
  | { readonly position: "cursor"; readonly member: RequestMember }
  | {
      readonly position: "page" | "offset";
      readonly member: RequestMember;
      readonly limit?: RequestMember;
      readonly defaultLimit?: number;
      readonly base: number;
      readonly evidence: readonly ("more" | "totalPages" | "total" | "next")[];
    };

type PagedRule = Extract<NextPageRule, { readonly position: "page" | "offset" }>;

/** The pages of an infinite query, as the libraries hold them. */
export interface PagedData<Item> {
  readonly pages: readonly { readonly body: { readonly items: readonly Item[] } }[];
}

const HEADERS_MEMBER = "headers";
const QUERY_PLACEMENT = "query";

// The request member that holds each placement's values.
const REQUEST_MEMBERS: Readonly<Record<RequestMember["in"], string>> = {
  query: "query",
  header: HEADERS_MEMBER,
};
const LINK_BASE = "http://link.invalid";
// The name of a rejection that is not an `Error`.
const REJECTION_NAME = "Error";

/** The result with its headers as a plain record of lower-case names. */
export function withPlainHeaders<Result extends ClientResult>(
  result: Result,
): WithPlainHeaders<Result>;
// One untyped implementation behind the typed signature: the result keeps every member but `headers`.
export function withPlainHeaders(result: ClientResult): object {
  const { headers, ...members } = result;

  return { ...members, headers: Object.fromEntries(headers.entries()) };
}

/** The success with plain headers, or the error `toError` builds from a declared error or an unexpected answer. */
export function successOrThrow<Result extends ClientResult, Thrown extends Error>(
  result: Result,
  toError: (failure: FailureOf<Result>) => Thrown,
): WithPlainHeaders<SuccessOf<Result>>;
export function successOrThrow(
  result: ClientResult,
  toError: (failure: ClientResult) => Error,
): object {
  if (!result.ok) throw toError(result);

  return withPlainHeaders(result);
}

/** The request as a key part: a copy without the headers the client fills, which change on every call. */
export function keyRequest(
  request: object | undefined,
  filledHeaderKeys: readonly string[],
): KeyRequest {
  if (request === undefined) return undefined;

  const members: Record<string, unknown> = { ...request };
  const headers = members[HEADERS_MEMBER];

  if (isRecord(headers)) {
    const kept = Object.entries(headers).filter(([key]) => !filledHeaderKeys.includes(key));

    if (kept.length === 0) delete members[HEADERS_MEMBER];
    else members[HEADERS_MEMBER] = Object.fromEntries(kept);
  }

  return members;
}

/**
 * The request of the page after `page`, read with `request`, or undefined when no next-page fact says a page
 * follows. A cursor list sets its cursor; a page or offset list moves its position by one page.
 */
export function nextPageRequest<Request extends object | undefined>(
  rule: NextPageRule,
  request: Request,
  page: unknown,
): Request | undefined;
export function nextPageRequest(
  rule: NextPageRule,
  request: object | undefined,
  page: unknown,
): object | undefined {
  const facts = pageFacts(page);

  if (facts === undefined) return undefined;

  if (rule.position === "cursor") {
    const cursor = facts.nextCursor ?? linkParam(facts.next, rule.member);

    return typeof cursor === "string" && cursor !== ""
      ? withMember(request, rule.member, cursor)
      : undefined;
  }

  const position = numberOf(memberOf(request, rule.member)) ?? rule.base;
  const limit = servedLimit(rule, request, facts);
  const step = rule.position === "page" ? 1 : limit;

  if (step === undefined || step <= 0) return undefined;

  const linked = numberOf(linkParam(facts.next, rule.member));

  return hasNextPage(rule, facts, position, limit)
    ? withMember(request, rule.member, linked ?? position + step)
    : undefined;
}

// The page size the server served: its `limit` fact (a clamped limit differs from the asked one), else the
// request's limit, else the operation's default, else the count of the page's items.
function servedLimit(
  rule: PagedRule,
  request: object | undefined,
  facts: Readonly<Record<string, unknown>>,
): number | undefined {
  const requestLimit =
    rule.limit === undefined ? undefined : numberOf(memberOf(request, rule.limit));
  const items = facts.items;

  return (
    numberOf(facts.limit) ??
    requestLimit ??
    rule.defaultLimit ??
    (Array.isArray(items) ? items.length : undefined)
  );
}

// The first fact the style gives decides; no fact ends the list.
function hasNextPage(
  rule: PagedRule,
  facts: Readonly<Record<string, unknown>>,
  position: number,
  limit: number | undefined,
): boolean {
  const pagesRead = pagesReadThrough(rule, position, limit);

  for (const evidence of rule.evidence) {
    const fact = facts[evidence];

    if (fact === undefined || fact === null) continue;

    switch (evidence) {
      case "more":
        return fact === true;
      case "totalPages":
        return pagesRead !== undefined && typeof fact === "number" && pagesRead < fact;
      case "total":
        return (
          typeof fact === "number" &&
          limit !== undefined &&
          recordsRead(rule, position, limit) < fact
        );
      case "next":
        return typeof fact === "string" && fact !== "";
    }
  }

  return false;
}

// The pages read up to this one: a page list counts from its base, an offset list divides by the page size.
function pagesReadThrough(
  rule: PagedRule,
  position: number,
  limit: number | undefined,
): number | undefined {
  if (rule.position === "page") return position - rule.base + 1;

  return limit === undefined || limit <= 0 ? undefined : Math.floor(position / limit) + 1;
}

function recordsRead(rule: PagedRule, position: number, limit: number): number {
  return rule.position === "page" ? (position - rule.base + 1) * limit : position + limit;
}

/** The caller's call options with the library's abort signal, combined with the caller's own signal if any. */
export function withSignal<Call extends object>(
  call: Call | undefined,
  signal: AbortSignal,
): Call & { readonly signal: AbortSignal };
export function withSignal(call: object | undefined, signal: AbortSignal): object {
  const callerSignal = isRecord(call) ? call.signal : undefined;

  return {
    ...call,
    signal: callerSignal instanceof AbortSignal ? AbortSignal.any([signal, callerSignal]) : signal,
  };
}

/** A declared error or an unexpected answer as a plain value a store keeps, with `toContractError` its class back. */
export interface ContractFailure<Operation extends string, Failure> {
  readonly kind: "contract";
  readonly operation: Operation;
  readonly failure: Failure;
}

/** A network failure, a timeout or an abort as a plain value a store keeps. */
export interface PlainRejection {
  readonly kind: "rejection";
  readonly name: string;
  readonly message: string;
}

/** A call's outcome as a store keeps it: its data, or its failure as a plain value. */
export type StoreOutcome<Data, Failure> =
  | { readonly data: Data; readonly error?: undefined }
  | { readonly error: Failure; readonly data?: undefined };

/** The success with plain headers as data; a declared error, an unexpected answer or a rejection as a plain error. */
export function settleForStore<Operation extends string, Result extends ClientResult>(
  operation: Operation,
  pending: Promise<Result>,
): Promise<
  StoreOutcome<
    WithPlainHeaders<SuccessOf<Result>>,
    ContractFailure<Operation, WithPlainHeaders<FailureOf<Result>>> | PlainRejection
  >
>;
export async function settleForStore(
  operation: string,
  pending: Promise<ClientResult>,
): Promise<StoreOutcome<object, ContractFailure<string, object> | PlainRejection>> {
  try {
    const result = await pending;

    if (result.ok) return { data: withPlainHeaders(result) };

    return { error: { kind: "contract", operation, failure: withPlainHeaders(result) } };
  } catch (rejection) {
    return { error: plainRejection(rejection) };
  }
}

/** The whole result with plain headers as data, a declared error included; only a rejection as a plain error. */
export function settleAsData<Result extends ClientResult>(
  pending: Promise<Result>,
): Promise<StoreOutcome<WithPlainHeaders<Result>, PlainRejection>>;
export async function settleAsData(
  pending: Promise<ClientResult>,
): Promise<StoreOutcome<object, PlainRejection>> {
  try {
    return { data: withPlainHeaders(await pending) };
  } catch (rejection) {
    return { error: plainRejection(rejection) };
  }
}

/** A rejection as a plain value: the name and message of the thrown error. */
export function plainRejection(rejection: unknown): PlainRejection {
  if (rejection instanceof Error) {
    return { kind: "rejection", name: rejection.name, message: rejection.message };
  }

  return { kind: "rejection", name: REJECTION_NAME, message: String(rejection) };
}

/** Whether a key starts with the members of `prefix`: equal strings, or records with equal members. */
export function keyStartsWith(key: unknown, prefix: readonly unknown[]): boolean {
  if (!Array.isArray(key) || key.length < prefix.length) return false;

  return prefix.every((member, index) => sameKeyMember(key[index], member));
}

function sameKeyMember(actual: unknown, expected: unknown): boolean {
  if (!isRecord(expected)) return actual === expected;

  return (
    isRecord(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([member, value]) => actual[member] === value)
  );
}

/** The keys of the mounted queries of each resource, counted, so a write revalidates the ones its filter skips. */
export class MountedKeys<Resource extends string> {
  private readonly counts = new Map<Resource, Map<string, number>>();

  /** Records a mounted key and returns the function that removes it, for an effect's cleanup. */
  add(resource: Resource, key: string): () => void {
    const keys = this.counts.get(resource) ?? new Map<string, number>();

    keys.set(key, (keys.get(key) ?? 0) + 1);
    this.counts.set(resource, keys);

    return () => {
      const count = keys.get(key) ?? 0;

      if (count <= 1) keys.delete(key);
      else keys.set(key, count - 1);
    };
  }

  keysOf(resource: Resource): string[] {
    return [...(this.counts.get(resource)?.keys() ?? [])];
  }
}

/**
 * The request each page of an infinite query was read with, by the page's data, for a library that hands the next
 * page's key builder the previous page only.
 */
export class PageRequests<Request extends object | undefined> {
  private readonly requests = new WeakMap<object, Request>();

  /** Keeps the request `page` was read with and returns the page. */
  remember<Page extends object>(page: Page, request: Request): Page {
    this.requests.set(page, request);

    return page;
  }

  /** The request of the page after `page`, or undefined when no next-page fact says a page follows. */
  nextAfter(rule: NextPageRule, page: object): Request | undefined {
    if (!this.requests.has(page)) {
      throw new Error(
        "The infinite query holds a page it did not read itself (a fallback or a restored cache), so the next page's request is unknown: load the first page through the generated infinite hook.",
      );
    }

    return nextPageRequest(rule, this.requests.get(page), page);
  }
}

/** Every item of an infinite query's pages, in order. */
export function itemsOf<Item>(data: PagedData<Item>): Item[] {
  return data.pages.flatMap((page) => [...page.body.items]);
}

/** The request with the operation's idempotency key, unless the caller passed one. */
export function withIdempotencyKey<Request extends object | undefined>(
  request: Request,
  headerKey: string,
  key: () => string,
): Request;
export function withIdempotencyKey(
  request: object | undefined,
  headerKey: string,
  key: () => string,
): object {
  const member = { in: "header", key: headerKey } as const;

  if (typeof memberOf(request, member) === "string") return request ?? {};

  return withMember(request, member, key());
}

/**
 * One idempotency key per mutation attempt chain: drawn on the first attempt and kept for the library's retries,
 * which pass the same attempt object; a new `mutate` passes a new one.
 */
export class IdempotencyKeys {
  private readonly keys = new WeakMap<object, string>();
  private readonly draw: () => string;

  constructor(draw: () => string) {
    this.draw = draw;
  }

  keyFor(attempt: object): string {
    const kept = this.keys.get(attempt);

    if (kept !== undefined) return kept;

    const key = this.draw();

    this.keys.set(attempt, key);

    return key;
  }
}

/** The key generator: the caller's, else `crypto.randomUUID`; a platform with neither is refused here. */
export function idempotencyKeyGenerator(generator: (() => string) | undefined): () => string {
  if (generator !== undefined) return generator;

  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error(
      "This platform has no crypto.randomUUID to draw idempotency keys: pass settings.idempotencyKey, a function returning a new unique key.",
    );
  }

  return () => globalThis.crypto.randomUUID();
}

function pageFacts(page: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(page)) return undefined;

  const body = page.body;

  return isRecord(body) ? body : undefined;
}

// The position parameter of a `next` link's target, the cursor or page the server chose.
function linkParam(link: unknown, member: RequestMember): string | undefined {
  if (typeof link !== "string" || member.in !== QUERY_PLACEMENT) return undefined;

  return new URL(link, LINK_BASE).searchParams.get(member.key) ?? undefined;
}

function memberOf(request: object | undefined, member: RequestMember): unknown {
  const requestMember = REQUEST_MEMBERS[member.in];
  const values =
    request === undefined
      ? undefined
      : Object.entries(request).find(([key]) => key === requestMember)?.[1];

  return isRecord(values) ? values[member.key] : undefined;
}

function withMember(request: object | undefined, member: RequestMember, value: unknown): object {
  const members: Record<string, unknown> = { ...request };
  const requestMember = REQUEST_MEMBERS[member.in];
  const values = members[requestMember];

  members[requestMember] = { ...(isRecord(values) ? values : {}), [member.key]: value };

  return members;
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") return value;

  if (typeof value !== "string" || value === "") return undefined;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
