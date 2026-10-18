// The Express-platform glue shared by the targets that run on Express (NestJS on Express, Express): the request
// target as Express routes it, the JSON parser's `verify` function that records the parsed byte count and keeps the
// raw body of signed routes, and a body parser's error mapped to its contract role. Copied into the generated tree
// as is.
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ContractError,
  codeOfStatus,
  isPlainObject,
  PAYLOAD_TOO_LARGE_ROLE,
  roleError,
  unexpectedError,
} from "./contract-error.js";
import {
  type ContractApi,
  type ContractRequest,
  type ContractRoute,
  matchContractRoute,
} from "./contract-route.js";

const PAYLOAD_TOO_LARGE = 413;
// The refusals of `body-parser` a contract route answers in the api's format, by the error's `type`.
const BODY_PARSER_REFUSAL_TYPES: readonly string[] = [
  "entity.parse.failed",
  "entity.too.large",
  "encoding.unsupported",
  "charset.unsupported",
];
const DEFAULT_METHOD = "GET";

/** The request as Express hands it on. */
export interface ExpressRequest extends IncomingMessage {
  originalUrl?: string;
  body?: unknown;
  rawBody?: unknown;
}

/** The body glue of one api: the parser's `verify` function and the byte count it recorded. */
export interface ExpressBodyGlue {
  /** The JSON parser's `verify` function, with NestJS `rawBody` off. */
  keepRawBody(request: IncomingMessage, response: ServerResponse, bytes: Buffer): void;
  /** The parsed byte count `keepRawBody` recorded, when the parser ran with it. */
  recordedBodyBytes(request: IncomingMessage): number | undefined;
}

// The request target as Express routes it: raw, never normalized (no dot segment resolved, no `\\` turned into `/`).
export function requestTarget(request: ExpressRequest): { path: string; rawQuery: string } {
  const target = request.originalUrl ?? request.url ?? "/";
  const queryStart = target.indexOf("?");

  return queryStart === -1
    ? { path: target, rawQuery: "" }
    : { path: target.slice(0, queryStart), rawQuery: target.slice(queryStart + 1) };
}

export function pathnameOf(request: ExpressRequest): string {
  return requestTarget(request).path;
}

/** The request as the shared checks read it. */
export function contractRequest(request: ExpressRequest): ContractRequest {
  const { path, rawQuery } = requestTarget(request);

  return {
    method: request.method ?? DEFAULT_METHOD,
    path,
    rawQuery,
    headers: request.headers,
    body: request.body,
    ...(Buffer.isBuffer(request.rawBody) ? { rawBody: request.rawBody } : {}),
    ...(request.socket.remoteAddress === undefined
      ? {}
      : { clientAddress: request.socket.remoteAddress }),
  };
}

export function expressBodyGlue(api: ContractApi): ExpressBodyGlue {
  const bodyBytesKey = Symbol(`seampact:${api.id}:bodyBytes`);

  const keepRawBody = (
    request: IncomingMessage,
    _response: ServerResponse,
    bytes: Buffer,
  ): void => {
    const matched = matchContractRoute(api, request.method ?? DEFAULT_METHOD, pathnameOf(request));

    if (matched === undefined) return;

    Reflect.set(request, bodyBytesKey, bytes.byteLength);

    if (matched.route.access.kind === "identity" && matched.route.access.signed !== undefined) {
      Reflect.set(request, "rawBody", Buffer.from(bytes));
    }
  };

  const recordedBodyBytes = (request: IncomingMessage): number | undefined => {
    const recorded: unknown = Reflect.get(request, bodyBytesKey);

    return typeof recorded === "number" ? recorded : undefined;
  };

  return { keepRawBody, recordedBodyBytes };
}

/** The HTTP status a body parser's error carries, as `body-parser` and `http-errors` set it. */
export function parserErrorStatus(exception: unknown): number | undefined {
  const status: unknown =
    isPlainObject(exception) || exception instanceof Error
      ? Reflect.get(exception, "status")
      : undefined;

  return typeof status === "number" ? status : undefined;
}

/** A `body-parser` refusal mapped to its contract role; undefined for any other error. */
export function bodyParserRefusal(route: ContractRoute, error: unknown): ContractError | undefined {
  const type: unknown =
    isPlainObject(error) || error instanceof Error ? Reflect.get(error, "type") : undefined;
  const status = parserErrorStatus(error);

  if (
    typeof type !== "string" ||
    !BODY_PARSER_REFUSAL_TYPES.includes(type) ||
    status === undefined
  ) {
    return undefined;
  }

  return bodyParserError(route, status, error);
}

/** A body parser's refusal on a contract route, as its contract role or the code of its status. */
export function bodyParserError(
  route: ContractRoute,
  status: number,
  exception: unknown,
): ContractError {
  if (status === PAYLOAD_TOO_LARGE) return payloadTooLargeError(route, exception);

  const code = codeOfStatus(route, status);

  return code === undefined ? unexpectedError(route, exception) : new ContractError(code);
}

// A parser limit below the route's would refuse bodies the contract accepts: a setup error, not the client's.
function payloadTooLargeError(route: ContractRoute, exception: unknown): ContractError {
  const parserLimit: unknown = isPlainObject(exception) ? exception.limit : undefined;
  const routeLimit = route.input?.limitBytes;

  if (typeof parserLimit === "number" && routeLimit !== undefined && parserLimit < routeLimit) {
    console.error(
      `seampact: the JSON parser's limit (${parserLimit} bytes) is below the limit of '${route.id}' (${routeLimit} bytes); set the parser limit to the generated LARGEST_BODY_LIMIT.`,
    );

    return unexpectedError(route, exception);
  }

  return roleError(route, PAYLOAD_TOO_LARGE_ROLE, { limitBytes: routeLimit });
}
