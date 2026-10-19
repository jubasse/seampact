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
  | { readonly status: number; readonly shape: "empty" | "item" | "table" }
  | { readonly status: number; readonly shape: "page"; readonly cursorParam: string };

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
const NEXT_RELATION = "next";
const LINK_VALUE = /<([^>]*)>([^,<]*)/g;
const RELATION_PARAMETER = /;\s*rel\s*=\s*"?([^";]*)"?/i;

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

  if (success.shape === "table") {
    return isTable(body) ? { ok: true, status, headers, body, ...replay } : undefined;
  }

  if (success.shape !== "page") {
    return body === undefined || body === null
      ? undefined
      : { ok: true, status, headers, body, ...replay };
  }

  if (!Array.isArray(body)) return undefined;

  const nextCursor = nextCursorOf(headers.get(LINK_HEADER), success.cursorParam);
  const page = nextCursor === undefined ? { items: body } : { items: body, nextCursor };

  return { ok: true, status, headers, body: page, ...replay };
}

// A table is a JSON object keyed by item id; an array or a scalar is outside the contract.
function isTable(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

// The cursor query param of the `Link` target whose relation is `next`; absent at the last page.
function nextCursorOf(link: string | null, cursorParam: string): string | undefined {
  if (link === null) return undefined;

  for (const [, target = "", parameters = ""] of link.matchAll(LINK_VALUE)) {
    const relations = RELATION_PARAMETER.exec(parameters)?.[1]?.split(/\s+/) ?? [];

    if (!relations.includes(NEXT_RELATION)) continue;

    return cursorOfTarget(target, cursorParam);
  }

  return undefined;
}

// `URL.canParse` is missing on some platforms (Hermes), so an unparsable target is caught instead.
function cursorOfTarget(target: string, cursorParam: string): string | undefined {
  try {
    return new URL(target, LINK_BASE).searchParams.get(cursorParam) ?? undefined;
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
