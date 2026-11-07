// The outgoing response check on a Node `ServerResponse` (ADR 0016 "The outgoing response check"): it wraps
// `writeHead`, `write` and `end` of one contract request's response, holds the body the verdict rules read, and
// decodes a compressed one with `node:zlib`.
import { constants } from "node:buffer";
import type { ServerResponse } from "node:http";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { BoundaryContext } from "./boundary-context.js";
import { type ContractReply, renderContractReply, unexpectedError } from "./contract-error.js";
import { settleIdempotency } from "./idempotency.js";
import { applyReplyHeaders } from "./node-reply.js";
import {
  errorBodyViolation,
  type HoldReason,
  leftToFrameworkInDebug,
  MAX_CHECKED_ERROR_BODY_BYTES,
  oversizedDecodedBodyViolation,
  oversizedErrorBodyViolation,
  reportViolation,
  statusVerdict,
  successBodyViolation,
  undecodableBodyViolation,
  unreadableEncodingViolation,
  warnViolation,
} from "./outgoing-verdict.js";
import {
  CACHE_CONTROL_HEADER,
  CONTENT_ENCODING_HEADER,
  CONTENT_LENGTH_HEADER,
  CONTENT_TYPE_HEADER,
  ETAG_HEADER,
} from "./reply-headers.js";
import { IDENTITY_ENCODING } from "./transport-checks.js";

const DECODERS: Readonly<
  Record<string, (body: Buffer, options: { maxOutputLength: number }) => Buffer>
> = { gzip: gunzipSync, deflate: inflateSync, br: brotliDecompressSync };

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
  let holdReason: HoldReason = "error";
  let warned = false;

  // Under `warn` the violation is logged once and the caller lets the reply go out; under `strict` it is replaced.
  const violation = (reason: string): void => {
    if (leftToFrameworkInDebug(context, request)) return;

    if (context.mode === "warn") {
      if (!warned) warnViolation(context, reason);

      warned = true;

      return;
    }

    phase = "replaced";
    void reportViolation(context, request, reason, recordedReply(response, held));

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
    if (context.api.frameworkEtag === "strip") response.removeHeader(ETAG_HEADER);

    const verdict = statusVerdict(context, status, cacheControlOf(response));

    if (verdict.kind === "violation") {
      violation(verdict.reason);

      if (phase === "undecided") phase = "passing";

      return;
    }

    if (verdict.kind === "pass") {
      phase = "passing";

      return;
    }

    holdReason = verdict.holdReason;
    phase = "holding";
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
          ? errorBodyViolation(
              context,
              response.statusCode,
              String(response.getHeader(CONTENT_TYPE_HEADER) ?? ""),
              cacheControlOf(response),
              decoded,
            )
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
        violation(oversizedErrorBodyViolation(MAX_CHECKED_ERROR_BODY_BYTES));

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

// The reply's `Cache-Control` as one string; a header set several times joins in order.
function cacheControlOf(response: ServerResponse): string {
  const value = response.getHeader(CACHE_CONTROL_HEADER);

  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
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
  const encoding = String(response.getHeader(CONTENT_ENCODING_HEADER) ?? IDENTITY_ENCODING)
    .trim()
    .toLowerCase();
  const decode = DECODERS[encoding];

  if (encoding === IDENTITY_ENCODING) return body;

  if (decode === undefined) return unreadableEncodingViolation(encoding);

  try {
    return decode(body, { maxOutputLength: maxBytes });
  } catch (error) {
    return error instanceof RangeError
      ? oversizedDecodedBodyViolation(maxBytes)
      : undecodableBodyViolation(encoding);
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
