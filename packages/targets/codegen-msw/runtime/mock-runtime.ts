// The runtime the generated MSW handlers call, copied beside them as is: it writes a typed answer the way the api's
// server would put it on the wire (the success envelope, the page facts, the error body in the api's error format), so
// the generated client reads a mock answer as it reads the server's.
import { type HttpHandler, HttpResponse, http } from "msw";

/** Where the mocked api lives: the `baseUrl` the app gives its client. */
export interface MockConfig {
  readonly baseUrl: string;
}

/** Headers a test adds to one answer, such as an `ETag` or the replay header of an idempotent write. */
export interface MockReplyInit {
  readonly headers?: Readonly<Record<string, string>>;
}

/** The arguments of `reply`: a declared success status and the body its handler returns. */
export type MockSuccessArguments<Output> = Output extends {
  readonly status: infer Status;
  readonly body: infer Body;
}
  ? [status: Status, body: Body, init?: MockReplyInit]
  : Output extends { readonly status: infer Status }
    ? [status: Status, body?: undefined, init?: MockReplyInit]
    : never;

/** The arguments of `error`: a declared error code and its params, when the code declares any. */
export type MockErrorArguments<Errors> = Errors extends {
  readonly code: infer Code;
  readonly params: infer Params;
}
  ? [code: Code, params: Params, init?: MockReplyInit]
  : Errors extends { readonly code: infer Code }
    ? [code: Code, params?: undefined, init?: MockReplyInit]
    : never;

/** What a resolver answers: a declared success (`status`, `body`) or a declared error (`status`, `code`, `params`). */
export type MockAnswer<Output, Errors> = (Output | Errors) & MockReplyInit;

export interface MockRequest {
  readonly request: Request;
  readonly params: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export type MockResolver<Output, Errors> = (
  request: MockRequest,
) => MockAnswer<Output, Errors> | Promise<MockAnswer<Output, Errors>>;

/** The handlers of one operation; pass one to `server.use` or `worker.use` to override the default in a test. */
export interface OperationMocks<Output, Errors> {
  /** Answers the contract's example of the operation; with none, it fails naming the operation. */
  readonly handler: HttpHandler;
  reply(...args: MockSuccessArguments<Output>): HttpHandler;
  error(...args: MockErrorArguments<Errors>): HttpHandler;
  resolve(resolver: MockResolver<Output, Errors>): HttpHandler;
}

type MockMethod = "get" | "post" | "put" | "patch" | "delete";

type FactSource =
  | { readonly from: "body"; readonly path: readonly string[] }
  | { readonly from: "header"; readonly header: string }
  | { readonly from: "link"; readonly rel: string }
  | { readonly from: "linkParam"; readonly rel: string; readonly param: string };

type SuccessWriting =
  | { readonly status: number; readonly shape: "empty" }
  | {
      readonly status: number;
      readonly shape: "payload";
      readonly media: string;
      readonly payload: readonly string[];
    }
  | {
      readonly status: number;
      readonly shape: "page";
      readonly media: string;
      readonly items: readonly string[];
      readonly facts: readonly { readonly role: string; readonly source: FactSource }[];
    };

/** How one error code is written in one format, the same on every operation that answers it. */
export interface ErrorWriting {
  readonly status: number;
  readonly media: string;
  /** The format's error body with the code's own slots filled; the params merge into it when `mergeParams`. */
  readonly body: Readonly<Record<string, unknown>>;
  readonly mergeParams: boolean;
  readonly noStore: boolean;
}

/** What one operation adds to a code it answers: the retry header it derives from the code's params. */
interface ErrorAttachment {
  readonly retryHeader?: { readonly name: string; readonly param: string; readonly unit: string };
}

/** The error writings of an api, by format id, then by code. */
export type ErrorWritings = Readonly<Record<string, Readonly<Record<string, ErrorWriting>>>>;

/** What the generator tells the runtime about one operation. */
export interface MockPlan {
  readonly operation: string;
  readonly member: string;
  readonly method: MockMethod;
  readonly path: string;
  readonly format: string;
  readonly successes: readonly SuccessWriting[];
  readonly errors: Readonly<Record<string, ErrorAttachment>>;
  readonly example?: { readonly name: string; readonly status: number; readonly value: unknown };
}

/** Thrown by a default handler whose operation has no example: MSW answers it as a 500 carrying this message. */
export class MissingMockReply extends Error {
  constructor(plan: MockPlan) {
    super(
      `seampact mocks: the operation '${plan.operation}' (${plan.method.toUpperCase()} ${plan.path}) has no example in the contract, so its mock has nothing to answer. Give it a reply in the test: server.use(mocks.${plan.member}.reply(status, body)), .error(code, params) or .resolve(resolver).`,
    );
    this.name = "MissingMockReply";
  }
}

const LINK_HEADER = "link";
const CONTENT_TYPE_HEADER = "content-type";
const CACHE_CONTROL_HEADER = "cache-control";
const NO_STORE = "no-store";
const SECONDS_UNIT = "s";
const MILLISECONDS_PER_SECOND = 1000;

export function operationMocks<Output, Errors>(
  config: MockConfig,
  plan: MockPlan,
  errorWritings: ErrorWritings,
): OperationMocks<Output, Errors> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}${plan.path}`;
  const handle = (answer: (request: MockRequest) => Response | Promise<Response>) =>
    http[plan.method](url, ({ request, params }) => answer({ request, params }));

  return {
    handler: handle(({ request }) => {
      if (plan.example === undefined) throw new MissingMockReply(plan);

      return successResponse(plan, plan.example.status, plan.example.value, {}, request);
    }),
    reply: (...args) => {
      const [status, body, init] = args;

      return handle(({ request }) => successResponse(plan, status, body, init ?? {}, request));
    },
    error: (...args) => {
      const [code, params, init] = args;

      return handle(() => errorResponse(plan, errorWritings, code, params, init ?? {}));
    },
    resolve: (resolver) =>
      handle(async (request) =>
        answerResponse(plan, errorWritings, await resolver(request), request.request),
      ),
  };
}

function answerResponse(
  plan: MockPlan,
  errorWritings: ErrorWritings,
  answer: unknown,
  request: Request,
): Response {
  if (!isRecord(answer) || typeof answer.status !== "number") {
    throw new Error(
      `seampact mocks: the resolver of '${plan.operation}' answered ${JSON.stringify(answer)}, not a { status, body } success or a { status, code, params } error.`,
    );
  }

  const init: MockReplyInit = isRecord(answer.headers)
    ? { headers: textRecord(answer.headers) }
    : {};

  if (typeof answer.code === "string")
    return errorResponse(plan, errorWritings, answer.code, answer.params, init);

  return successResponse(plan, answer.status, answer.body, init, request);
}

function successResponse(
  plan: MockPlan,
  status: unknown,
  value: unknown,
  init: MockReplyInit,
  request: Request,
): Response {
  const writing = plan.successes.find((success) => success.status === status);

  if (writing === undefined) {
    const declared = plan.successes.map((success) => success.status).join(", ");

    throw new Error(
      `seampact mocks: '${plan.operation}' declares no success ${String(status)}; it declares ${declared}.`,
    );
  }

  const headers = new Headers(init.headers);

  if (writing.shape === "empty") return new HttpResponse(null, { status: writing.status, headers });

  headers.set(CONTENT_TYPE_HEADER, writing.media);

  if (writing.shape === "payload") {
    return jsonResponse(placedAt(writing.payload, value), writing.status, headers);
  }

  return pageResponse(writing, value, headers, request);
}

function pageResponse(
  writing: Extract<SuccessWriting, { shape: "page" }>,
  value: unknown,
  headers: Headers,
  request: Request,
): Response {
  const page = isRecord(value) ? value : {};
  let body = placedAt(writing.items, page.items);
  const links: string[] = [];

  for (const { role, source } of writing.facts) {
    const fact = page[role];

    if (fact === undefined || fact === null) continue;

    if (source.from === "body") body = withMemberAt(body, source.path, fact);
    else if (source.from === "header") headers.set(source.header, String(fact));
    else if (source.from === "link") links.push(`<${String(fact)}>; rel="${source.rel}"`);
    else
      links.push(`<${queryReference(request, source.param, String(fact))}>; rel="${source.rel}"`);
  }

  if (links.length > 0) headers.set(LINK_HEADER, links.join(", "));

  return jsonResponse(body, writing.status, headers);
}

// The page link a server writes for a cursor: the request's own query with the cursor replaced, as a query-only
// reference the client resolves against the URL it called.
function queryReference(request: Request, param: string, value: string): string {
  const query = new URL(request.url).searchParams;

  query.set(param, value);

  return `?${query.toString()}`;
}

function errorResponse(
  plan: MockPlan,
  errorWritings: ErrorWritings,
  code: unknown,
  params: unknown,
  init: MockReplyInit,
): Response {
  const attachment =
    typeof code === "string" && Object.hasOwn(plan.errors, code) ? plan.errors[code] : undefined;
  const formatWritings = Object.hasOwn(errorWritings, plan.format)
    ? errorWritings[plan.format]
    : undefined;
  const writing =
    typeof code === "string" && formatWritings !== undefined && Object.hasOwn(formatWritings, code)
      ? formatWritings[code]
      : undefined;

  if (attachment === undefined || writing === undefined) {
    const declared = Object.keys(plan.errors).join(", ");

    throw new Error(
      `seampact mocks: '${plan.operation}' declares no error '${String(code)}'; it declares ${declared}.`,
    );
  }

  const headers = new Headers(init.headers);
  const body =
    writing.mergeParams && isRecord(params) ? { ...writing.body, ...params } : writing.body;

  headers.set(CONTENT_TYPE_HEADER, writing.media);

  if (writing.noStore) headers.set(CACHE_CONTROL_HEADER, NO_STORE);

  const { retryHeader } = attachment;
  const retryValue =
    retryHeader === undefined || !isRecord(params) ? undefined : params[retryHeader.param];

  if (retryHeader !== undefined && typeof retryValue === "number") {
    const headerValue =
      retryHeader.unit === SECONDS_UNIT
        ? Math.ceil(retryValue / MILLISECONDS_PER_SECOND)
        : retryValue;

    headers.set(retryHeader.name, String(headerValue));
  }

  return jsonResponse(body, writing.status, headers);
}

// The value at a member path of an otherwise empty body; `[]` is the value itself.
function placedAt(path: readonly string[], value: unknown): unknown {
  return path.reduceRight<unknown>((inner, member) => ({ [member]: inner }), value);
}

function withMemberAt(body: unknown, path: readonly string[], value: unknown): unknown {
  const [first, ...rest] = path;

  if (first === undefined) return value;

  const record = isRecord(body) ? body : {};

  return { ...record, [first]: withMemberAt(record[first], rest, value) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([name, text]) => [name, String(text)]));
}

// The body as JSON under the media type the headers already carry (`application/problem+json` for an error).
function jsonResponse(body: unknown, status: number, headers: Headers): Response {
  return new HttpResponse(JSON.stringify(body), { status, headers });
}
