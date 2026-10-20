// The request and response machinery every generated method calls: it encodes the request the operation plan
// describes, sends it with the platform fetch, and sorts the response into a success, a declared error or an
// unexpected answer. Response bodies are not checked: unknown keys and enum members reach the caller as sent.

/**
 * The client's settings: the server root, an optional fetch (for credentials, tests or a platform without a global
 * fetch), default headers, and an optional idempotency key generator (for a platform without
 * `crypto.randomUUID`, such as React Native's Hermes).
 */
export interface ClientConfig {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: () => string;
}

/** Per-call settings: a caller signal, and a timeout that wins over the operation's budget. */
export interface CallOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** The settings of an operation with a deadline header and no budget: the timeout sets the deadline. */
export interface TimedCallOptions extends CallOptions {
  readonly timeoutMs: number;
}

/** A declared success response, with the response headers. */
export type SuccessResult<Output, Extra> = Output extends unknown
  ? Output & { readonly ok: true; readonly headers: Headers } & Extra
  : never;

/** A page success as the client reads it: the items, and the page facts its paging style declares. */
export type PagedOutput<Output, PageStatus, Facts> = Output extends {
  readonly status: PageStatus;
  readonly body: { readonly items: infer Items };
}
  ? Omit<Output, "body"> & { readonly body: { readonly items: Items } & Facts }
  : Output;

/** The derived 304 of an operation with an ETag: the cached copy is still current. */
export interface NotModifiedResult {
  readonly ok: true;
  readonly status: 304;
  readonly headers: Headers;
}

/** Whether the server answered from its idempotency store instead of running the request again. */
export interface ReplayFlag {
  readonly replayed: boolean;
}

/** A declared error code of the operation, with its params when the code declares some. */
export type ErrorResult<Errors> = Errors extends unknown
  ? Errors & { readonly ok: false; readonly unexpected: false; readonly headers: Headers }
  : never;

/** Any answer the contract does not declare for the operation; `body` is the parsed JSON, or the text. */
export interface UnexpectedResult {
  readonly ok: false;
  readonly unexpected: true;
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}

export type CallResult<Success, Errors> = Success | ErrorResult<Errors> | UnexpectedResult;

/** Thrown by a client generated with `errorStyle: throw`: carries the declared error or the unexpected answer. */
export class ContractError<Operation extends string, Failure> extends Error {
  readonly operation: Operation;
  readonly failure: Failure;

  constructor(operation: Operation, failure: Failure) {
    super(`The operation '${operation}' answered ${describeFailure(failure)}.`);
    this.name = "ContractError";
    this.operation = operation;
    this.failure = failure;
  }
}

/**
 * The request after the client's own headers were made optional; a path, query or headers member whose keys are
 * all optional is optional itself. The body stays as declared.
 */
export type ClientInput<Input, Filled extends string> = OptionalMembers<{
  [Member in keyof Input]: Member extends "headers"
    ? OptionalKeys<Input[Member], Filled>
    : Input[Member];
}>;

/** The arguments of a method: the request is optional when it has no required member. */
export type CallArguments<Input, Options> = object extends Input
  ? [request?: Input, options?: Options]
  : [request: Input, options?: Options];

/** The arguments of a method whose options carry a required timeout. */
export type TimedCallArguments<Input> = [request: Input, options: TimedCallOptions];

type OptionalKeys<Members, Keys extends string> = Omit<Members, Keys> &
  Partial<Pick<Members, Keys & keyof Members>>;

type OptionalMembers<Request> = Omit<Request, EmptyMembers<Request>> &
  Partial<Pick<Request, EmptyMembers<Request>>>;

type EmptyMembers<Request> = {
  [Member in keyof Request]: Member extends "path" | "query" | "headers"
    ? object extends Request[Member]
      ? Member
      : never
    : never;
}[keyof Request];

/** How the generated code describes one operation to the runtime. */
export interface OperationPlan {
  readonly method: string;

  /** The path template, each `{name}` filled with the percent-encoded path param. */
  readonly path: string;
  readonly query: readonly QueryPlan[];

  /** Each header by its lower-case request key and its wire name. */
  readonly headers: readonly (readonly [key: string, wireName: string])[];
  readonly hasJsonBody: boolean;
  readonly idempotency?: { readonly header: string; readonly replayHeader: string };
  readonly budgetMs?: number;
  readonly deadlineHeader?: string;
  readonly successes: readonly SuccessPlan[];
  readonly notModified: boolean;
  readonly errors: readonly ErrorPlan[];
}

export interface QueryPlan {
  readonly name: string;

  /** `text` and `number` write one value; `list` writes the items comma-separated (`style: form`, `explode: false`). */
  readonly wire: "text" | "number" | "list";
}

export type SuccessPlan =
  | { readonly status: number; readonly shape: "empty" }
  | {
      readonly status: number;
      readonly shape: "item" | "table" | "list";

      /** The member path of the payload in the body; empty for the bare payload. */
      readonly payload: readonly string[];
    }
  | {
      readonly status: number;
      readonly shape: "page";
      readonly items: readonly string[];
      readonly facts: readonly PageFact[];
    };

/** One page fact, named after its paging response role, and where the response carries it. */
export interface PageFact {
  readonly role: string;
  readonly value: "number" | "text" | "boolean";

  /** A required fact missing from the response makes the answer unexpected; an optional one is left out. */
  readonly required: boolean;
  readonly source:
    | { readonly from: "body"; readonly path: readonly string[] }
    | { readonly from: "header"; readonly header: string }
    | { readonly from: "link"; readonly rel: string }
    | { readonly from: "linkParam"; readonly rel: string; readonly param: string };
}

export interface ErrorPlan {
  readonly code: string;
  readonly status: number;

  /** The members of the code's params schema, picked from the problem body; absent when it declares none. */
  readonly params?: readonly string[];
}

export interface RequestValues {
  readonly path?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

type Answer =
  | { readonly ok: true; readonly [member: string]: unknown }
  | ErrorResult<{ readonly status: number; readonly code: string; readonly params?: unknown }>
  | UnexpectedResult;

const NOT_MODIFIED = 304;
const JSON_MEDIA = "application/json";
const LINK_HEADER = "link";
const RELATION_PARAMETER = "rel";

// Resolves a relative `Link` target; only its query is read.
const LINK_BASE = "http://link.invalid";

/**
 * Sends one operation and answers its result. A network failure, a timeout or an abort rejects. The answer is
 * typed by the generated method from the contract: the runtime does not check response bodies (tolerant reads).
 */
export async function callOperation<Result>(
  config: ClientConfig,
  plan: OperationPlan,
  request?: RequestValues,
  options?: CallOptions,
): Promise<Result> {
  return asDeclared(await answerOf(config, plan, request ?? {}, options ?? {}));
}

/** As `callOperation`, but a declared error or an unexpected answer is thrown as a `ContractError`. */
export async function callOperationOrThrow<Success, Operation extends string>(
  operation: Operation,
  config: ClientConfig,
  plan: OperationPlan,
  request?: RequestValues,
  options?: CallOptions,
): Promise<Success> {
  const answer = await answerOf(config, plan, request ?? {}, options ?? {});

  if (!answer.ok) throw new ContractError(operation, answer);

  return asDeclared(answer);
}

/**
 * Refuses, when the client is created, a config that a call would fail on: no fetch on the platform and none
 * given, or an operation with a generated idempotency key, no `crypto.randomUUID` and no generator given.
 */
export function checkClientConfig(
  config: ClientConfig,
  plans: Readonly<Record<string, OperationPlan>>,
): void {
  if (config.fetch === undefined && typeof globalThis.fetch !== "function") {
    throw new TypeError(
      "This platform has no global fetch: pass one as `fetch` in the client config.",
    );
  }

  const generatesKeys = Object.values(plans).some((plan) => plan.idempotency !== undefined);

  if (generatesKeys && config.idempotencyKey === undefined && platformRandomUuid() === undefined) {
    throw new TypeError(
      "This platform has no crypto.randomUUID to generate idempotency keys: pass a generator as `idempotencyKey` in the client config.",
    );
  }
}

function platformRandomUuid(): (() => string) | undefined {
  const platformCrypto: { readonly randomUUID?: () => string } | undefined = globalThis.crypto;

  return typeof platformCrypto?.randomUUID === "function" ? () => crypto.randomUUID() : undefined;
}

// The one unchecked step: the response is read as the contract declares it, never validated.
function asDeclared<Declared>(answer: Answer): Declared {
  return answer as Declared;
}

async function answerOf(
  config: ClientConfig,
  plan: OperationPlan,
  request: RequestValues,
  options: CallOptions,
): Promise<Answer> {
  const timeoutMs = options.timeoutMs ?? plan.budgetMs;
  const headers = requestHeaders(config, plan, request, timeoutMs);
  const send = config.fetch ?? fetch;
  const { member, release } = callSignal(options.signal, timeoutMs);

  try {
    const response = await send(requestUrl(config, plan, request), {
      method: plan.method.toUpperCase(),
      headers,
      ...(plan.hasJsonBody ? { body: JSON.stringify(request.body) } : {}),
      ...member,
    });

    return await readAnswer(plan, response);
  } finally {
    release();
  }
}

function requestUrl(config: ClientConfig, plan: OperationPlan, request: RequestValues): string {
  const path = plan.path.replace(/\{([^}]+)\}/g, (_placeholder, name: string) =>
    pathSegment(name, request.path?.[name]),
  );
  const query = plan.query.flatMap((param) => queryPair(param, request.query?.[param.name]));
  const search = query.length === 0 ? "" : `?${query.join("&")}`;

  return `${config.baseUrl.replace(/\/+$/, "")}${path}${search}`;
}

// One escaped segment. The URL parser reads `.` and `..` (even as `%2E`) as dot segments and an empty value
// collapses the segment, so either would reach another route: they are refused.
function pathSegment(name: string, value: unknown): string {
  const text = String(value);

  if (text === "" || text === "." || text === "..") {
    throw new TypeError(
      `The path parameter '${name}' must be one non-empty segment, not '${text}': it would reach another route.`,
    );
  }

  return encodeURIComponent(text);
}

// `encodeURIComponent` writes `+` as `%2B`: servers decode a query string as a form, where `+` is a space
// (ADR 0002 section 7).
function queryPair(param: QueryPlan, value: unknown): string[] {
  if (value === undefined) return [];

  const encodedValue =
    param.wire === "list" && Array.isArray(value)
      ? value.map((item) => encodeURIComponent(String(item))).join(",")
      : encodeURIComponent(String(value));

  return [`${encodeURIComponent(param.name)}=${encodedValue}`];
}

function requestHeaders(
  config: ClientConfig,
  plan: OperationPlan,
  request: RequestValues,
  timeoutMs: number | undefined,
): Headers {
  refuseFilledDefaultHeaders(config, plan);

  const headers = new Headers(config.headers);

  for (const [key, wireName] of plan.headers) {
    const value = request.headers?.[key];

    if (value !== undefined) headers.set(wireName, String(value));
  }

  if (plan.hasJsonBody) headers.set("content-type", JSON_MEDIA);

  if (plan.idempotency !== undefined && !headers.has(plan.idempotency.header)) {
    headers.set(plan.idempotency.header, idempotencyKeyOf(config));
  }

  if (plan.deadlineHeader !== undefined && !headers.has(plan.deadlineHeader)) {
    if (timeoutMs === undefined) {
      throw new TypeError(
        `The deadline header '${plan.deadlineHeader}' needs a timeout: pass 'timeoutMs' in the call options.`,
      );
    }

    // The deadline is an RFC 3339 UTC date-time with milliseconds.
    headers.set(plan.deadlineHeader, new Date(Date.now() + timeoutMs).toISOString());
  }

  return headers;
}

// Only a call's own request supplies these: a default would be shared by every call, so a repeated key or a stale deadline.
function refuseFilledDefaultHeaders(config: ClientConfig, plan: OperationPlan): void {
  const defaults = new Headers(config.headers);
  const filled = [plan.idempotency?.header, plan.deadlineHeader];

  for (const name of filled) {
    if (name !== undefined && defaults.has(name)) {
      throw new TypeError(
        `'config.headers' must not carry '${name}': the client fills it on each call. Pass it in the call's request instead.`,
      );
    }
  }
}

interface CallSignal {
  readonly member: { signal?: AbortSignal };
  /** Clears the fallback timer and the listeners on the caller's signal, once the call settled. */
  readonly release: () => void;
}

function callSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): CallSignal {
  const releases: (() => void)[] = [];
  const signals = [
    ...(callerSignal === undefined ? [] : [callerSignal]),
    ...(timeoutMs === undefined ? [] : [timeoutSignal(timeoutMs, releases)]),
  ];
  const release = () => {
    for (const each of releases) each();
  };

  const [onlySignal] = signals;

  if (onlySignal === undefined) return { member: {}, release };

  const signal = signals.length === 1 ? onlySignal : anySignal(signals, releases);

  return { member: { signal }, release };
}

// `AbortSignal.timeout` and `AbortSignal.any` are missing on some platforms (React Native's Hermes): an
// `AbortController` stands in for them there. The fallback timeout aborts with a `TimeoutError` as the native one
// does, built from `Error` since `DOMException` may be missing too.
function timeoutSignal(timeoutMs: number, releases: (() => void)[]): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(timeoutMs);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    const reason = new Error("The operation timed out.");

    reason.name = "TimeoutError";
    controller.abort(reason);
  }, timeoutMs);

  releases.push(() => clearTimeout(timer));

  return controller.signal;
}

function anySignal(signals: AbortSignal[], releases: (() => void)[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);

  const controller = new AbortController();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }

    const onAbort = () => controller.abort(signal.reason);

    signal.addEventListener("abort", onAbort, { once: true });
    releases.push(() => signal.removeEventListener("abort", onAbort));
  }

  return controller.signal;
}

// `checkClientConfig` refuses a missing generator at creation; the throw covers a direct `callOperation`.
function idempotencyKeyOf(config: ClientConfig): string {
  const generate = config.idempotencyKey ?? platformRandomUuid();

  if (generate === undefined) {
    throw new TypeError(
      "No idempotency key generator: pass one as `idempotencyKey` in the client config.",
    );
  }

  return generate();
}

async function readAnswer(plan: OperationPlan, response: Response): Promise<Answer> {
  const { status, headers } = response;
  const { body, isJson } = await readBody(response);

  if (status === NOT_MODIFIED && plan.notModified) return { ok: true, status, headers };

  const success = plan.successes.find((each) => each.status === status);

  if (success !== undefined) {
    const answer =
      isJson || success.shape === "empty"
        ? successAnswer(plan, success, response, body)
        : undefined;

    return answer ?? unexpected(response, body);
  }

  return errorAnswer(plan, response, body) ?? unexpected(response, body);
}

// The parsed JSON (typed only under a JSON media type), the text when it is not JSON, or undefined when the response has no body.
async function readBody(response: Response): Promise<{ body: unknown; isJson: boolean }> {
  const text = await response.text();

  if (text === "") return { body: undefined, isJson: false };

  try {
    return {
      body: JSON.parse(text),
      isJson: isJsonMediaType(response.headers.get("content-type")),
    };
  } catch {
    // Not JSON: an error answer or a declared JSON success with this body comes back as unexpected, with the text.
    return { body: text, isJson: false };
  }
}

// `application/json` or a `+json` suffix, whatever the parameters or case.
function isJsonMediaType(contentType: string | null): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";

  return mediaType === JSON_MEDIA || mediaType.endsWith("+json");
}

function successAnswer(
  plan: OperationPlan,
  success: SuccessPlan,
  response: Response,
  body: unknown,
): Answer | undefined {
  const { status, headers } = response;
  const replay =
    plan.idempotency === undefined
      ? {}
      : { replayed: headers.get(plan.idempotency.replayHeader)?.trim().toLowerCase() === "true" };

  if (success.shape === "empty") return { ok: true, status, headers, ...replay };

  if (success.shape === "page") {
    const page = pageOf(success, body, headers);

    return page === undefined ? undefined : { ok: true, status, headers, body: page, ...replay };
  }

  const payload = memberAt(body, success.payload);
  const isPayload =
    success.shape === "table"
      ? isTable(payload)
      : success.shape === "list"
        ? Array.isArray(payload)
        : payload !== undefined && payload !== null;

  return isPayload ? { ok: true, status, headers, body: payload, ...replay } : undefined;
}

// The items and every fact the paging style declares; undefined when the items or a required fact is missing.
function pageOf(
  success: Extract<SuccessPlan, { shape: "page" }>,
  body: unknown,
  headers: Headers,
): Record<string, unknown> | undefined {
  const items = memberAt(body, success.items);

  if (!Array.isArray(items)) return undefined;

  const page: Record<string, unknown> = { items };

  for (const fact of success.facts) {
    const value = factValue(fact, body, headers);

    if (value === undefined && fact.required) return undefined;

    if (value !== undefined) page[fact.role] = value;
  }

  return page;
}

// A missing or `null` fact, or one of another JSON type, reads as undefined.
function factValue(fact: PageFact, body: unknown, headers: Headers): unknown {
  const { source } = fact;

  if (source.from === "body") {
    const value = memberAt(body, source.path);

    return typeof value === JSON_TYPE_OF_FACT[fact.value] ? value : undefined;
  }

  const text =
    source.from === "header"
      ? headers.get(source.header)
      : linkTargetOf(headers.get(LINK_HEADER), source.rel);

  if (text === null || text === undefined) return undefined;

  if (source.from === "linkParam") return queryParamOf(text, source.param);

  return factFromText(fact.value, text.trim());
}

const JSON_TYPE_OF_FACT = { number: "number", text: "string", boolean: "boolean" } as const;
const BOOLEAN_TEXTS: ReadonlyMap<string, boolean> = new Map([
  ["true", true],
  ["false", false],
]);

function factFromText(value: PageFact["value"], text: string): unknown {
  if (value === "text") return text;

  if (value === "boolean") return BOOLEAN_TEXTS.get(text.toLowerCase());

  const number = text === "" ? Number.NaN : Number(text);

  return Number.isFinite(number) ? number : undefined;
}

// The member at `path`, or undefined when a step is not a JSON object member.
function memberAt(body: unknown, path: readonly string[]): unknown {
  let value = body;

  for (const member of path) {
    if (!isTable(value) || !Object.hasOwn(value, member)) return undefined;

    value = value[member];
  }

  return value;
}

// A table is a JSON object keyed by item id; an array or a scalar is outside the contract.
function isTable(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

// The target of the first `Link` value whose relations hold `rel`; absent at either end of the list. Relation
// types compare case-insensitively (RFC 8288 section 2.1.1).
function linkTargetOf(link: string | null, rel: string): string | undefined {
  if (link === null) return undefined;

  const wantedRelation = rel.toLowerCase();

  return linkValuesOf(link).find((value) => value.relations.includes(wantedRelation))?.target;
}

interface LinkValue {
  readonly target: string;
  readonly relations: readonly string[];
}

// Splits a `Link` header into its `<target>; param=value` link-values; a quoted string may hold `,`, `;` or `<`.
function linkValuesOf(link: string): LinkValue[] {
  const values: LinkValue[] = [];
  let position = link.indexOf("<");

  while (position !== -1) {
    const targetEnd = link.indexOf(">", position);

    if (targetEnd === -1) break;

    const target = link.slice(position + 1, targetEnd);
    const { parameters, end } = linkParametersOf(link, targetEnd + 1);
    const relations = parameters.get(RELATION_PARAMETER)?.toLowerCase().split(/\s+/) ?? [];

    values.push({ target, relations: relations.filter((relation) => relation !== "") });
    position = link.indexOf("<", end);
  }

  return values;
}

// The parameters of one link-value from `start` to the `,` ending it; the first occurrence of a name wins.
function linkParametersOf(
  link: string,
  start: number,
): { parameters: Map<string, string>; end: number } {
  const parameters = new Map<string, string>();
  let position = start;

  while (position < link.length && link[position] !== ",") {
    if (link[position] !== ";") {
      position += 1;

      continue;
    }

    const nameEnd = endOfToken(link, position + 1, "=;,");
    const name = link
      .slice(position + 1, nameEnd)
      .trim()
      .toLowerCase();
    const { value, end } =
      link[nameEnd] === "=" ? parameterValueOf(link, nameEnd + 1) : { value: "", end: nameEnd };

    if (!parameters.has(name)) parameters.set(name, value);

    position = end;
  }

  return { parameters, end: position };
}

function parameterValueOf(link: string, start: number): { value: string; end: number } {
  let position = start;

  while (link[position] === " " || link[position] === "\t") position += 1;

  if (link[position] !== '"') {
    const end = endOfToken(link, position, ";,");

    return { value: link.slice(position, end).trim(), end };
  }

  let value = "";

  position += 1;

  while (position < link.length && link[position] !== '"') {
    // A quoted-pair keeps the next character as is.
    if (link[position] === "\\") position += 1;

    value += link[position] ?? "";
    position += 1;
  }

  return { value, end: position + 1 };
}

function endOfToken(link: string, start: number, stops: string): number {
  let position = start;

  while (position < link.length && !stops.includes(link[position] ?? "")) position += 1;

  return position;
}

// `URL.canParse` is missing on some platforms (Hermes), so an unparsable target is caught instead.
function queryParamOf(target: string, param: string): string | undefined {
  try {
    return new URL(target, LINK_BASE).searchParams.get(param) ?? undefined;
  } catch {
    // A target the URL parser refuses carries no cursor: the page is the last one for this client.
    return undefined;
  }
}

function errorAnswer(plan: OperationPlan, response: Response, body: unknown): Answer | undefined {
  if (typeof body !== "object" || body === null || !("code" in body)) return undefined;

  const declared = plan.errors.find(
    (error) => error.code === body.code && error.status === response.status,
  );

  if (declared === undefined) return undefined;

  const base = {
    ok: false,
    unexpected: false,
    status: declared.status,
    code: declared.code,
    headers: response.headers,
  } as const;

  if (declared.params === undefined) return base;

  const members = Object.entries(body).filter(([name]) => declared.params?.includes(name));

  return { ...base, params: Object.fromEntries(members) };
}

function unexpected(response: Response, body: unknown): UnexpectedResult {
  return {
    ok: false,
    unexpected: true,
    status: response.status,
    body,
    headers: response.headers,
  };
}

function describeFailure(failure: unknown): string {
  if (typeof failure !== "object" || failure === null || !("status" in failure)) return "an error";

  const code = "code" in failure ? ` '${String(failure.code)}'` : "";

  return `${String(failure.status)}${code}`;
}
