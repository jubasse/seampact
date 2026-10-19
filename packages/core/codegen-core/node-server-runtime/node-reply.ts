// The boundary's own replies written on a Node `ServerResponse`: a contract reply after its idempotency record, a
// contract error reported and rendered in the api's format, and the 404 of a request the api does not serve.
// Copied into the generated tree of the Node server targets as is.
import type { ServerResponse } from "node:http";
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
import { BODY_HEADERS, groupedHeaders, mergedVary, VARY_HEADER } from "./outgoing-verdict.js";

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

/**
 * Replaces the body headers and the reply's own names, merges `Vary`, and keeps what the app's middleware set
 * (CORS, security headers, a throttler's `Retry-After`).
 */
export function applyReplyHeaders(
  response: ServerResponse,
  headers: ContractReply["headers"],
): void {
  const grouped = groupedHeaders(headers);

  for (const name of [...BODY_HEADERS, ...grouped.keys()]) {
    if (name !== VARY_HEADER) response.removeHeader(name);
  }

  for (const [name, values] of grouped) {
    response.setHeader(
      name,
      name === VARY_HEADER ? mergedVary(headerValues(response, VARY_HEADER), values) : values,
    );
  }
}

/** The values of a response header as text, none when it is not set. */
export function headerValues(response: ServerResponse, name: string): string[] {
  const value = response.getHeader(name);

  if (value === undefined) return [];

  return Array.isArray(value) ? value : [String(value)];
}

/** Reports an unexpected failure to the hook (or the log), then writes the error in the api's format. */
export async function respondWithError(
  response: ServerResponse,
  context: BoundaryContext | undefined,
  hooks: BoundaryHooks | undefined,
  api: ContractApi,
  route: ContractRoute | undefined,
  error: ContractError,
  request: ReportedRequest,
): Promise<void> {
  await reportContractError(hooks, api, route, error, request);
  await writeContractReply(response, context, renderContractReply(api, route, error));
}

/**
 * The reply to a request the contract does not serve: the 404 in the api's format of the route `notServedRoute`
 * finds, else a bare 404 with no body, since no operation fails there.
 */
export async function respondNotServed(
  response: ServerResponse,
  hooks: BoundaryHooks | undefined,
  api: ContractApi,
  request: ReportedRequest,
): Promise<void> {
  const route = notServedRoute(api, request.path);

  if (route === undefined) {
    response.writeHead(NOT_FOUND_STATUS, { "content-length": "0" });
    response.end();

    return;
  }

  await respondWithError(response, undefined, hooks, api, route, notFoundError(route), request);
}
