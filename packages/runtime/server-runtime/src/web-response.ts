// The boundary's own replies as Web-standard `Response`s (ADR 0020 "The reply path"): a contract reply after its
// idempotency record, a contract error reported and rendered in the api's format, the 404 of a request the api does
// not serve, and the boundary's header names set on a `Headers` someone else filled.
import type { BoundaryContext } from "./boundary-context.js";
import type { BoundaryHooks } from "./boundary-hooks.js";
import { type ContractError, type ContractReply, renderContractReply } from "./contract-error.js";
import type { ContractApi, ContractRoute } from "./contract-route.js";
import {
  NOT_FOUND_STATUS,
  notFoundError,
  notServedRoute,
  type ReportedRequest,
  reportContractError,
} from "./error-reply.js";
import { settleIdempotency } from "./idempotency.js";
import {
  BODY_HEADERS,
  CONTENT_LENGTH_HEADER,
  groupedHeaders,
  mergedVary,
  VARY_HEADER,
} from "./reply-headers.js";

/** A `Response` carrying a reply of the boundary's own, as is. */
export function contractResponse(reply: ContractReply): Response {
  const headers = new Headers();

  replaceReplyHeaders(headers, reply.headers);

  return new Response(reply.body.byteLength === 0 ? null : bodyOf(reply.body), {
    status: reply.status,
    headers,
  });
}

/** Completes the idempotency record with a reply of the boundary's own, then builds its `Response`. */
export async function settledContractResponse(
  context: BoundaryContext | undefined,
  reply: ContractReply,
): Promise<Response> {
  if (context?.idempotencyKey !== undefined) {
    const key = context.idempotencyKey;

    delete context.idempotencyKey;
    await settleIdempotency(context.hooks, key, reply);
  }

  return contractResponse(reply);
}

/**
 * Replaces the body headers and the reply's own names, merges `Vary`, and keeps every other header (CORS, security
 * headers, a throttler's `Retry-After`).
 */
export function replaceReplyHeaders(
  headers: Headers,
  replyHeaders: ContractReply["headers"],
): void {
  for (const name of BODY_HEADERS) headers.delete(name);

  setHeaderNames(headers, groupedHeaders(replyHeaders));
}

/**
 * Sets the reply's own names again on the headers of a reply middleware rebuilt, `Vary` merged; the body headers
 * stay those of the final reply, since a compression middleware encodes the body.
 */
export function restoreReplyNames(headers: Headers, replyHeaders: ContractReply["headers"]): void {
  const grouped = groupedHeaders(replyHeaders);

  for (const name of BODY_HEADERS) grouped.delete(name);

  setHeaderNames(headers, grouped);
}

/** Reports an unexpected failure to the hook (or the log), then renders the error in the api's format. */
export async function errorResponse(
  context: BoundaryContext | undefined,
  hooks: BoundaryHooks | undefined,
  api: ContractApi,
  route: ContractRoute | undefined,
  error: ContractError,
  request: ReportedRequest,
): Promise<Response> {
  await reportContractError(hooks, api, route, error, request);

  return settledContractResponse(context, renderContractReply(api, route, error));
}

/**
 * The reply to a request the contract does not serve: the 404 in the api's format of the route `notServedRoute`
 * finds, else a bare 404 with no body, since no operation fails there.
 */
export async function notServedResponse(
  hooks: BoundaryHooks | undefined,
  api: ContractApi,
  request: ReportedRequest,
): Promise<Response> {
  const route = notServedRoute(api, request.path);

  if (route === undefined) {
    return new Response(null, {
      status: NOT_FOUND_STATUS,
      headers: { [CONTENT_LENGTH_HEADER]: "0" },
    });
  }

  return errorResponse(undefined, hooks, api, route, notFoundError(route), request);
}

/** The bytes as a `Response` body, copied into an `ArrayBuffer` of their own. */
export function bodyOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function setHeaderNames(headers: Headers, grouped: ReadonlyMap<string, readonly string[]>): void {
  for (const [name, values] of grouped) {
    if (name === VARY_HEADER) {
      const current = headers.get(VARY_HEADER);

      headers.set(VARY_HEADER, mergedVary(current === null ? [] : [current], values));

      continue;
    }

    headers.delete(name);

    for (const value of values) headers.append(name, value);
  }
}
