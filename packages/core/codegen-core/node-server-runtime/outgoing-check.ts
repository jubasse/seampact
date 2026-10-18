// The request context of a contract route and the outgoing response check (ADR 0016 "The outgoing response
// check"): whoever writes the reply, an undeclared status, a framework ETag or 304, or an error body outside the
// api's format or codes is a violation, handled by the `responses` mode. Copied into the generated tree as is.
import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:buffer";
import type { ServerResponse } from "node:http";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { AccessGrant } from "./access-checks.js";
import {
  type BoundaryHooks,
  reportUnexpected,
  type UnexpectedErrorContext,
} from "./boundary-hooks.js";
import {
  type ContractReply,
  isPlainObject,
  renderContractReply,
  unexpectedError,
} from "./contract-error.js";
import type { ContractApi, ContractRoute, ResponsesMode } from "./contract-route.js";
import { settleIdempotency } from "./idempotency.js";
import { IDENTITY_ENCODING } from "./transport-checks.js";

/** The longest error body the check holds to read its code; a longer one is a violation. */
export const MAX_CHECKED_ERROR_BODY_BYTES = 65536;

const NOT_MODIFIED = 304;
const ETAG_HEADER = "etag";
const VARY_HEADER = "vary";
const CONTENT_LENGTH_HEADER = "content-length";
// Headers that describe the body: the boundary replaces them, and keeps every other header the app set.
const BODY_HEADERS = ["content-type", CONTENT_LENGTH_HEADER, "content-encoding", ETAG_HEADER];
const DECODERS: Readonly<
  Record<string, (body: Buffer, options: { maxOutputLength: number }) => Buffer>
> = { gzip: gunzipSync, deflate: inflateSync, br: brotliDecompressSync };
const LIST_SHAPES: ReadonlySet<string> = new Set(["list", "table", "page"]);

/** The state of one contract request, opened before any check runs. */
export interface BoundaryContext {
  readonly api: ContractApi;
  readonly route: ContractRoute;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly hooks: BoundaryHooks;
  readonly bodyValidation: boolean;
  mode: ResponsesMode;
  /** True while the boundary writes its own reply, which skips the contract checks. */
  boundaryWriting: boolean;
  idempotencyKey?: string;
  grant?: AccessGrant;
  input?: unknown;
  /** An exception no seampact filter claims, kept so a violating reply reports it to `onUnexpectedError`. */
  unclaimedException?: unknown;
}

/** What `onUnexpectedError` receives for a reply outside the contract when no exception is known. */
export interface ViolatingReply {
  readonly status: number;
  readonly headers: readonly (readonly [name: string, value: string])[];
  readonly body: Uint8Array;
  readonly violation: string;
}

/** The context of the contract request being served, absent outside one. */
export const boundaryContext = new AsyncLocalStorage<BoundaryContext>();

/** The context hooks receive in `onUnexpectedError`. */
export function unexpectedContext(
  context: BoundaryContext,
  method: string,
  path: string,
): UnexpectedErrorContext {
  return { api: context.api.id, operation: context.route.id, method, path };
}

/** Writes a reply of the boundary's own with `res.end`, after completing its idempotency record. */
export async function writeContractReply(
  response: ServerResponse,
  context: BoundaryContext | undefined,
  reply: ContractReply,
): Promise<void> {
  if (context?.idempotencyKey !== undefined) {
    const key = context.idempotencyKey;

    delete context.idempotencyKey;
    await settleIdempotency(context.hooks, key, reply);
  }

  if (context !== undefined) context.boundaryWriting = true;

  if (response.headersSent) {
    console.error(
      `seampact: a reply of operation '${context?.route.id ?? "(none)"}' was already sent; the boundary's ${reply.status} is dropped.`,
    );

    return;
  }

  response.statusCode = reply.status;
  applyReplyHeaders(response, reply.headers);
  response.end(reply.body);
}

// Replaces the body headers and the reply's own names, merges `Vary`, and keeps what the app's middleware set
// (CORS, security headers, a throttler's `Retry-After`).
function applyReplyHeaders(response: ServerResponse, headers: ContractReply["headers"]): void {
  const grouped = groupedHeaders(headers);

  for (const name of [...BODY_HEADERS, ...grouped.keys()]) {
    if (name !== VARY_HEADER) response.removeHeader(name);
  }

  for (const [name, values] of grouped) {
    response.setHeader(
      name,
      name === VARY_HEADER ? mergedVary(response.getHeader(VARY_HEADER), values) : values,
    );
  }
}

function mergedVary(
  current: ReturnType<ServerResponse["getHeader"]>,
  added: readonly string[],
): string {
  const names: string[] = [];

  for (const value of [...(Array.isArray(current) ? current : [current]), ...added]) {
    if (value === undefined) continue;

    for (const name of String(value).split(",")) {
      const trimmed = name.trim();

      if (trimmed !== "" && !names.some((known) => known.toLowerCase() === trimmed.toLowerCase())) {
        names.push(trimmed);
      }
    }
  }

  return names.join(", ");
}

function groupedHeaders(headers: ContractReply["headers"]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const [name, value] of headers) {
    const lowerName = name.toLowerCase();

    grouped.set(lowerName, [...(grouped.get(lowerName) ?? []), value]);
  }

  return grouped;
}

type Phase = "undecided" | "passing" | "holding" | "replaced";

type NodeFunction = (...args: unknown[]) => unknown;

/** Installs the check on this request's response object only, around `writeHead`, `write` and `end`. */
export function installOutgoingCheck(
  response: ServerResponse,
  context: BoundaryContext,
  request: { readonly method: string; readonly path: string },
): void {
  const originalWriteHead = bound(response, "writeHead");
  const originalWrite = bound(response, "write");
  const originalEnd = bound(response, "end");
  const held: Buffer[] = [];
  const recorded: Buffer[] = [];
  let heldBytes = 0;
  let phase: Phase = "undecided";
  let headArgs: unknown[] | undefined;
  let holdReason: "error" | "success" = "error";
  let warned = false;

  // Under `warn` the violation is logged once and the caller lets the reply go out; under `strict` it is replaced.
  const violation = (reason: string): void => {
    if (context.mode === "warn") {
      if (!warned) {
        console.warn(
          `seampact: contract violation on operation '${context.route.id}': ${reason}; sent as written (responses: warn).`,
        );
      }

      warned = true;

      return;
    }

    phase = "replaced";
    void reportViolation(reason);

    const reply = renderContractReply(
      context.api,
      context.route,
      unexpectedError(context.route, reason),
    );

    void settle(reply);
    applyReplyHeaders(response, [
      ...reply.headers,
      [CONTENT_LENGTH_HEADER, String(reply.body.byteLength)],
    ]);
    originalWriteHead(reply.status);
    originalEnd(Buffer.from(reply.body));
  };

  const reportViolation = async (reason: string): Promise<void> => {
    const where = unexpectedContext(context, request.method, request.path);
    const reported: unknown =
      context.unclaimedException ??
      ({
        ...recordedReply(response, held),
        violation: reason,
      } satisfies ViolatingReply);

    if (context.hooks.onUnexpectedError === undefined) {
      console.error(
        `seampact: contract violation on operation '${context.route.id}': ${reason}; replaced by a 500 (responses: strict).`,
        context.unclaimedException ?? "",
      );
    }

    await reportUnexpected(context.hooks, reported, where);
  };

  const settle = async (reply: ContractReply): Promise<void> => {
    const key = context.idempotencyKey;

    if (key === undefined) return;

    delete context.idempotencyKey;
    await settleIdempotency(context.hooks, key, reply);
  };

  // Sends the head and the chunks held so far, and lets the rest pass.
  const release = (): void => {
    phase = "passing";

    if (headArgs !== undefined) originalWriteHead(...headArgs);

    const body = Buffer.concat(held);

    held.length = 0;
    recorded.push(body);

    if (body.byteLength > 0) originalWrite(body);
  };

  const decide = (status: number): void => {
    if (context.boundaryWriting) {
      phase = "passing";

      return;
    }

    // Express's weak ETag, on any status the boundary did not write (ADR 0012 step 10).
    response.removeHeader(ETAG_HEADER);

    if (status === NOT_MODIFIED) {
      violation("a 304 the boundary did not write");

      if (phase === "undecided") phase = "passing";

      return;
    }

    const success = context.route.responses.find((entry) => entry.status === status);

    if (success !== undefined) {
      holdReason = "success";
      phase = context.bodyValidation && success.itemValidator !== undefined ? "holding" : "passing";

      return;
    }

    if (Object.values(context.route.errors).some((entry) => entry.status === status)) {
      holdReason = "error";
      phase = "holding";

      return;
    }

    violation(`the undeclared status ${status}`);

    if (phase === "undecided") phase = "passing";
  };

  const flush = async (): Promise<void> => {
    const body = Buffer.concat(held);
    const decoded = decodedBody(
      response,
      body,
      holdReason === "error" ? MAX_CHECKED_ERROR_BODY_BYTES : constants.MAX_LENGTH,
    );
    const reason =
      typeof decoded === "string"
        ? decoded
        : holdReason === "error"
          ? errorBodyViolation(context, response, decoded)
          : await successBodyViolation(context, response.statusCode, decoded);

    if (reason !== undefined) {
      violation(reason);

      if (phase === "replaced") return;
    }

    phase = "passing";

    if (headArgs !== undefined) originalWriteHead(...headArgs);

    recorded.push(body);
    originalEnd(body);
  };

  const record = (chunk: unknown, encoding: unknown): Buffer | undefined => {
    if (chunk === undefined || chunk === null || typeof chunk === "function") return undefined;

    if (typeof chunk === "string") {
      return Buffer.from(
        chunk,
        typeof encoding === "string" && Buffer.isEncoding(encoding) ? encoding : "utf8",
      );
    }

    return chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk));
  };

  define(response, "writeHead", (...written: unknown[]) => {
    const args = context.boundaryWriting ? written : withHeadersSet(response, written);

    // A held head is written later: the body checks read the status from the response meanwhile.
    if (typeof args[0] === "number") response.statusCode = args[0];

    if (phase === "undecided") decide(response.statusCode);

    if (phase === "passing") return originalWriteHead(...args);

    if (phase === "holding") headArgs = args;

    return response;
  });

  define(response, "write", (...args: unknown[]) => {
    if (phase === "undecided") decide(response.statusCode);

    const callback = args.find((arg) => typeof arg === "function");

    if (phase === "passing") {
      const buffer = record(args[0], args[1]);

      if (buffer !== undefined && context.idempotencyKey !== undefined) recorded.push(buffer);

      return originalWrite(...args);
    }

    if (phase === "holding") {
      const buffer = record(args[0], args[1]);

      if (buffer !== undefined) {
        held.push(buffer);
        heldBytes += buffer.byteLength;
      }

      if (holdReason === "error" && heldBytes > MAX_CHECKED_ERROR_BODY_BYTES) {
        violation(`an error body over ${MAX_CHECKED_ERROR_BODY_BYTES} bytes`);

        if (phase === "holding") release();
      }
    }

    if (typeof callback === "function") callback();

    return true;
  });

  define(response, "end", (...args: unknown[]) => {
    if (phase === "undecided") decide(response.statusCode);

    const buffer = record(args[0], args[1]);

    if (phase === "passing") {
      if (buffer !== undefined) recorded.push(buffer);

      const result = originalEnd(...args);

      if (!context.boundaryWriting) void settle(recordedReply(response, recorded));

      return result;
    }

    if (phase === "holding") {
      if (buffer !== undefined) held.push(buffer);

      void flush().then(() => {
        if (phase === "passing") void settle(recordedReply(response, recorded));
      });
    }

    return response;
  });
}

// Moves the headers of `writeHead(status, [message,] headers)` onto the response, so the check sees them as it sees
// `setHeader` (a framework may pass its ETag this way); returns the arguments without them.
function withHeadersSet(response: ServerResponse, args: readonly unknown[]): unknown[] {
  const headersIndex = typeof args[1] === "string" ? 2 : 1;
  const headers = args[headersIndex];

  if (headers === undefined || headers === null) return [...args];

  for (const [name, value] of headerPairs(headers)) {
    const current = response.getHeader(name);

    response.setHeader(
      name,
      current === undefined
        ? value
        : [...(Array.isArray(current) ? current : [String(current)]), ...[value].flat()],
    );
  }

  return args.slice(0, headersIndex);
}

// A `writeHead` headers argument: an object, a flat `[name, value, ...]` list, or a list of pairs.
function headerPairs(headers: unknown): [string, string | string[]][] {
  if (!Array.isArray(headers)) {
    return typeof headers === "object" && headers !== null
      ? Object.entries(headers).flatMap(([name, value]) =>
          value === undefined
            ? []
            : [[name, Array.isArray(value) ? value.map(String) : String(value)]],
        )
      : [];
  }

  if (headers.every((entry) => Array.isArray(entry))) {
    return headers.map((entry) => [String(entry[0]), String(entry[1])]);
  }

  const pairs: [string, string][] = [];

  for (let index = 0; index + 1 < headers.length; index += 2) {
    pairs.push([String(headers[index]), String(headers[index + 1])]);
  }

  return pairs;
}

function recordedReply(response: ServerResponse, chunks: readonly Buffer[]): ContractReply {
  const headers: [string, string][] = [];

  for (const name of response.getHeaderNames()) {
    const value = response.getHeader(name);

    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) headers.push([name, String(item)]);
    }
  }

  return { status: response.statusCode, headers, body: Buffer.concat(chunks) };
}

// The held body as the client decodes it, or the violation: a compressed body (compression middleware) is decoded
// within the cap, and an encoding the check cannot decode is outside the contract.
function decodedBody(response: ServerResponse, body: Buffer, maxBytes: number): Buffer | string {
  const encoding = String(response.getHeader("content-encoding") ?? IDENTITY_ENCODING)
    .trim()
    .toLowerCase();
  const decode = DECODERS[encoding];

  if (encoding === IDENTITY_ENCODING) return body;

  if (decode === undefined)
    return `a body in the content encoding '${encoding}', which the check cannot read`;

  try {
    return decode(body, { maxOutputLength: maxBytes });
  } catch (error) {
    return error instanceof RangeError
      ? `an error body over ${maxBytes} bytes once decoded`
      : `a body that does not decode as '${encoding}'`;
  }
}

function errorBodyViolation(
  context: BoundaryContext,
  response: ServerResponse,
  body: Buffer,
): string | undefined {
  const contentType = String(response.getHeader("content-type") ?? "")
    .split(";")[0]
    ?.trim();

  if (contentType !== context.api.format.media)
    return `an error body of media '${contentType}', not the api's format`;

  const parsed = parseJson(body);
  const code = isPlainObject(parsed) ? parsed[context.api.format.codeMember] : undefined;

  if (typeof code !== "string") return "an error body without a code in the api's format";

  const entry = Object.hasOwn(context.route.errors, code) ? context.route.errors[code] : undefined;

  if (entry === undefined || entry.status !== response.statusCode) {
    return `the code '${code}' with status ${response.statusCode}, which the operation does not declare`;
  }

  return undefined;
}

async function successBodyViolation(
  context: BoundaryContext,
  status: number,
  body: Buffer,
): Promise<string | undefined> {
  const response = context.route.responses.find((entry) => entry.status === status);
  const validator = response?.itemValidator;

  if (response === undefined || validator === undefined) return undefined;

  const parsed = parseJson(body);
  const isList = LIST_SHAPES.has(response.shape);

  if (isList && !Array.isArray(parsed))
    return `a ${status} ${response.shape} body that is not a JSON array`;

  const items = isList && Array.isArray(parsed) ? parsed : [parsed];

  for (const item of items) {
    const result = await validator["~standard"].validate(item);

    if (result.issues !== undefined)
      return `a ${status} body that fails its output schema: ${result.issues[0]?.message ?? ""}`;
  }

  return undefined;
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    // Not JSON: the caller reports the body as outside the format.
    return undefined;
  }
}

function bound(response: ServerResponse, name: "writeHead" | "write" | "end"): NodeFunction {
  const original: unknown = response[name];

  if (typeof original !== "function") throw new Error(`the response has no ${name} function`);

  return (...args: unknown[]) => Reflect.apply(original, response, args);
}

function define(
  response: ServerResponse,
  name: "writeHead" | "write" | "end",
  value: NodeFunction,
): void {
  Object.defineProperty(response, name, { value, writable: true, configurable: true });
}
