// The request context of a contract route and the outgoing response check (ADR 0016 "The outgoing response
// check"): whoever writes the reply, an undeclared status, a framework ETag or 304, or an error body outside the
// api's format or codes is a violation, handled by the `responses` mode. Copied into the generated tree as is.
import { AsyncLocalStorage } from "node:async_hooks";
import type { ServerResponse } from "node:http";
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

/** The longest error body the check holds to read its code; a longer one is a violation. */
export const MAX_CHECKED_ERROR_BODY_BYTES = 65536;

const NOT_MODIFIED = 304;
const ETAG_HEADER = "etag";

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

  for (const name of response.getHeaderNames()) response.removeHeader(name);

  response.statusCode = reply.status;

  for (const [name, values] of groupedHeaders(reply.headers)) response.setHeader(name, values);

  response.end(reply.body);
}

function groupedHeaders(headers: ContractReply["headers"]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const [name, value] of headers) grouped.set(name, [...(grouped.get(name) ?? []), value]);

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

  const violation = (reason: string): void => {
    const where = unexpectedContext(context, request.method, request.path);

    if (context.mode === "warn") {
      console.warn(
        `seampact: contract violation on operation '${context.route.id}': ${reason}; sent as written (responses: warn).`,
      );

      return;
    }

    phase = "replaced";
    void reportUnexpected(context.hooks, new Error(`contract violation: ${reason}`), where);

    const reply = renderContractReply(
      context.api,
      context.route,
      unexpectedError(context.route, reason),
    );

    void settle(reply);
    for (const name of response.getHeaderNames()) response.removeHeader(name);

    originalWriteHead(reply.status, Object.fromEntries(reply.headers));
    originalEnd(Buffer.from(reply.body));
  };

  const settle = async (reply: ContractReply): Promise<void> => {
    const key = context.idempotencyKey;

    if (key === undefined) return;

    delete context.idempotencyKey;
    await settleIdempotency(context.hooks, key, reply);
  };

  const decide = (status: number): void => {
    if (context.boundaryWriting) {
      phase = "passing";

      return;
    }

    if (status === NOT_MODIFIED) {
      violation("a 304 the boundary did not write");

      return;
    }

    const success = context.route.responses.find((entry) => entry.status === status);

    if (success !== undefined) {
      response.removeHeader(ETAG_HEADER);
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
  };

  const flush = async (): Promise<void> => {
    const body = Buffer.concat(held);
    const reason =
      holdReason === "error"
        ? errorBodyViolation(context, response, body)
        : await successBodyViolation(context, response.statusCode, body);

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

  define(response, "writeHead", (...args: unknown[]) => {
    if (phase === "undecided") decide(typeof args[0] === "number" ? args[0] : response.statusCode);

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

      if (heldBytes > MAX_CHECKED_ERROR_BODY_BYTES)
        violation(`an error body over ${MAX_CHECKED_ERROR_BODY_BYTES} bytes`);
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
  const validator = context.route.responses.find((entry) => entry.status === status)?.itemValidator;

  if (validator === undefined) return undefined;

  const parsed = parseJson(body);
  const items = Array.isArray(parsed) ? parsed : [parsed];

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
