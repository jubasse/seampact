// The outgoing response check on a Web-standard `Response` (ADR 0020 "The outgoing response check"): the boundary's
// own `Response` passes untouched; any other is checked as an app reply by the shared verdict rules, its error body
// read within the cap and decoded with `DecompressionStream`, a foreign ETag stripped and the boundary's header names
// set again. It returns the `Response` that goes out and never writes on a socket. Copied into the generated tree of
// the Web-standard server targets as is.
import type { BoundaryContext } from "./boundary-context.js";
import { type ContractReply, renderContractReply, unexpectedError } from "./contract-error.js";
import type { ReportedRequest } from "./error-reply.js";
import { settleIdempotency } from "./idempotency.js";
import {
  errorBodyViolation,
  type HoldReason,
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
import { CONTENT_ENCODING_HEADER, CONTENT_TYPE_HEADER, ETAG_HEADER } from "./reply-headers.js";
import { IDENTITY_ENCODING } from "./transport-checks.js";
import {
  type ByteStream,
  byteStreamOf,
  contentCoding,
  decodedStream,
  readCapped,
} from "./web-body-stream.js";
import { bodyOf, replaceReplyHeaders, restoreReplyNames } from "./web-response.js";

const HEAD_METHOD = "HEAD";
const UNREADABLE_REPLY_STATUS = 500;
const EMPTY_BODY = new Uint8Array();

/** The `Response` the boundary returned for a request, and the reply it carries. */
interface BoundaryResponse {
  readonly response: Response;
  readonly reply: ContractReply;
}

/** A reply about to go out: its status line, headers and body. */
interface OutgoingReply {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
}

const boundaryResponses = new WeakMap<BoundaryContext, BoundaryResponse>();

/** Records the `Response` the boundary returns for this request, which the check then passes untouched. */
export function recordBoundaryResponse(
  context: BoundaryContext,
  response: Response,
  reply: ContractReply,
): void {
  boundaryResponses.set(context, { response, reply });
}

/**
 * The `Response` that goes out for a request a contract route's handler served: the boundary's own as is, any other
 * checked as an app reply, under `strict` the api's 500 in place of a violation.
 */
export async function checkOutgoingResponse(
  context: BoundaryContext,
  request: ReportedRequest,
  response: Response,
): Promise<Response> {
  const own = boundaryResponses.get(context);

  if (own?.response === response) return response;

  const outgoing: OutgoingReply = {
    status: response.status,
    statusText: response.statusText,
    headers: appReplyHeaders(response, own),
  };

  // Hono rebuilds the boundary's `Response` around the same body when a middleware sets a header after `next()`.
  if (own !== undefined && isRebuiltBoundaryResponse(own.response, response)) {
    return new Response(response.body, outgoing);
  }

  const verdict = statusVerdict(context, response.status);

  if (verdict.kind === "violation") {
    return violatingResponse(context, request, outgoing, response.body, EMPTY_BODY, verdict.reason);
  }

  // A HEAD reply carries no body to check: its status and headers are.
  if (verdict.kind === "pass" || request.method === HEAD_METHOD) {
    return passedResponse(context, outgoing, response.body);
  }

  return heldResponse(context, request, outgoing, response.body, verdict.holdReason);
}

// The app's headers with a foreign ETag stripped and the boundary's own names set again, `Vary` merged.
function appReplyHeaders(response: Response, own: BoundaryResponse | undefined): Headers {
  const headers = new Headers(response.headers);
  const ownEtag = own?.response.headers.get(ETAG_HEADER) ?? null;

  if (headers.get(ETAG_HEADER) !== ownEtag) headers.delete(ETAG_HEADER);

  if (own !== undefined) restoreReplyNames(headers, own.reply.headers);

  return headers;
}

function isRebuiltBoundaryResponse(own: Response, response: Response): boolean {
  return response.status === own.status && response.body === own.body;
}

// The error body read within the cap, the success body read whole, each decoded, then checked.
async function heldResponse(
  context: BoundaryContext,
  request: ReportedRequest,
  outgoing: OutgoingReply,
  body: ByteStream | null,
  holdReason: HoldReason,
): Promise<Response> {
  const cap = holdReason === "error" ? MAX_CHECKED_ERROR_BODY_BYTES : Number.POSITIVE_INFINITY;
  const read =
    body === null ? { kind: "complete" as const, bytes: EMPTY_BODY } : await readCapped(body, cap);

  if (read.kind === "over") {
    return violatingResponse(
      context,
      request,
      outgoing,
      read.whole,
      read.held,
      oversizedErrorBodyViolation(MAX_CHECKED_ERROR_BODY_BYTES),
    );
  }

  const decoded = await decodedBody(outgoing.headers.get(CONTENT_ENCODING_HEADER), read.bytes, cap);
  const reason =
    typeof decoded === "string"
      ? decoded
      : holdReason === "error"
        ? errorBodyViolation(
            context,
            outgoing.status,
            outgoing.headers.get(CONTENT_TYPE_HEADER) ?? "",
            decoded,
          )
        : await successBodyViolation(context, outgoing.status, decoded);

  if (reason !== undefined) {
    return violatingResponse(context, request, outgoing, read.bytes, read.bytes, reason);
  }

  return passedResponse(context, outgoing, read.bytes);
}

// Under `warn` the reply goes out as written with the violation logged; under `strict` the api's 500 replaces it.
async function violatingResponse(
  context: BoundaryContext,
  request: ReportedRequest,
  outgoing: OutgoingReply,
  body: ByteStream | Uint8Array | null,
  heldBytes: Uint8Array,
  reason: string,
): Promise<Response> {
  if (context.mode === "warn") {
    warnViolation(context, reason);

    return passedResponse(context, outgoing, body);
  }

  if (body instanceof ReadableStream) await body.cancel();

  await reportViolation(context, request, reason, {
    status: outgoing.status,
    headers: [...outgoing.headers],
    body: heldBytes,
  });

  const reply = renderContractReply(
    context.api,
    context.route,
    unexpectedError(context.route, reason),
  );

  await settle(context, reply);
  replaceReplyHeaders(outgoing.headers, reply.headers);

  return new Response(bodyOf(reply.body), { status: reply.status, headers: outgoing.headers });
}

// The reply goes out; an idempotent operation's record is completed with it, a body stream read on a copy.
function passedResponse(
  context: BoundaryContext,
  outgoing: OutgoingReply,
  body: ByteStream | Uint8Array | null,
): Response {
  const sent = body instanceof Uint8Array ? bytesBody(body) : body;

  if (context.idempotencyKey === undefined) return new Response(sent, outgoing);

  if (!(sent instanceof ReadableStream)) {
    void settle(context, recordedReply(outgoing, body instanceof Uint8Array ? body : EMPTY_BODY));

    return new Response(sent, outgoing);
  }

  const [toClient, toRecord] = sent.tee();

  void settleFromStream(context, outgoing, toRecord);

  return new Response(toClient, outgoing);
}

async function settleFromStream(
  context: BoundaryContext,
  outgoing: OutgoingReply,
  stream: ByteStream,
): Promise<void> {
  try {
    const read = await readCapped(stream, Number.POSITIVE_INFINITY);

    await settle(
      context,
      recordedReply(outgoing, read.kind === "complete" ? read.bytes : read.held),
    );
  } catch (error) {
    console.error(
      `seampact: the reply of operation '${context.route.id}' could not be read for its idempotency record; the key is released.`,
      error,
    );
    // A 5xx releases the key, so a retry runs the operation again.
    await settle(context, { status: UNREADABLE_REPLY_STATUS, headers: [], body: EMPTY_BODY });
  }
}

async function settle(context: BoundaryContext, reply: ContractReply): Promise<void> {
  const key = context.idempotencyKey;

  if (key === undefined) return;

  delete context.idempotencyKey;
  await settleIdempotency(context.hooks, key, reply);
}

function recordedReply(outgoing: OutgoingReply, body: Uint8Array): ContractReply {
  return { status: outgoing.status, headers: [...outgoing.headers], body };
}

function bytesBody(bytes: Uint8Array): ArrayBuffer | null {
  return bytes.byteLength === 0 ? null : bodyOf(bytes);
}

// The held body as the client decodes it, or the violation: a compressed body is decoded within the cap, and a
// coding the check cannot decode is outside the contract.
async function decodedBody(
  header: string | null,
  body: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array | string> {
  const coding = contentCoding(header);

  if (coding === IDENTITY_ENCODING) return body;

  const decoded = decodedStream(byteStreamOf(body), coding);

  if (decoded === undefined) return unreadableEncodingViolation(coding);

  try {
    const read = await readCapped(decoded, maxBytes);

    if (read.kind === "complete") return read.bytes;

    await read.whole.cancel();

    return oversizedDecodedBodyViolation(maxBytes);
  } catch {
    // The decoder failed on the bytes: the body is outside the contract, reported by name.
    return undecodableBodyViolation(coding);
  }
}
