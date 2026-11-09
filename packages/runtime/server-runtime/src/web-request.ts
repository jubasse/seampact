// The Web-standard request glue: the raw request target of a `Request`, the request as the shared checks read it,
// and the bounded read of a contract route's body (ADR 0020 "The Web-standard adapter"): a declared length over the
// route's limit refused before reading, a gzip, deflate or br body decoded, both byte counts bounded while reading,
// the raw bytes kept on signed routes, and zero bytes read as no body.
import {
  type ContractError,
  PAYLOAD_TOO_LARGE_ROLE,
  roleError,
  unexpectedError,
} from "./contract-error.js";
import type { ContractRequest, ContractRoute } from "./contract-route.js";
import { clientStatusError, type ReportedRequest } from "./error-reply.js";
import { charsetRefusal, IDENTITY_ENCODING } from "./transport-checks.js";
import {
  type ByteStream,
  canDecode,
  contentCoding,
  decodedStream,
  readCapped,
} from "./web-body-stream.js";

const UNSUPPORTED_MEDIA_ROLE = "unsupportedMediaType";
const BAD_REQUEST = 400;
const UTF8_KEEPING_BOM = new TextDecoder("utf-8", { ignoreBOM: true });

/** A contract route's body as the boundary read it: parsed JSON, and its raw bytes on a signed route. */
export interface ReadRequestBody {
  readonly body: unknown;
  readonly raw?: Uint8Array;
}

const NO_BODY: ReadRequestBody = { body: undefined };

// Raised inside the read when the encoded bytes pass the route's limit.
class EncodedBodyOverLimit extends Error {}

/**
 * The request target as sent, read from `request.url`: the URL parser has resolved dot segments and turned `\` into
 * `/`; any other percent-encoding, `//` and a trailing slash are kept.
 */
export function webRequestTarget(request: Request): { path: string; rawQuery: string } {
  const url = new URL(request.url);

  return { path: url.pathname, rawQuery: url.search.slice(1) };
}

/** The method and raw path a reply or a report names. */
export function webReportedRequest(request: Request): ReportedRequest {
  return { method: request.method, path: webRequestTarget(request).path };
}

/** The request as the shared checks read it, with the body the boundary read and the client address supplied. */
export function webContractRequest(
  request: Request,
  read: ReadRequestBody,
  clientAddress: string | undefined,
): ContractRequest {
  const { path, rawQuery } = webRequestTarget(request);

  return {
    method: request.method,
    path,
    rawQuery,
    headers: Object.fromEntries(request.headers),
    body: read.body,
    ...(read.raw === undefined ? {} : { rawBody: read.raw }),
    ...(clientAddress === undefined ? {} : { clientAddress }),
  };
}

/**
 * Reads the body of a contract route within its limit, or throws the refusal: the 413 past the limit, the 415 for a
 * content coding or charset the boundary does not read, the 400 for a corrupt body, and a 500 naming `bodyUsedFix`
 * when app middleware read the body first. Given `truncatedBodyFix`, a body shorter than its declared length is a 500
 * naming it, for a platform that may cut the body before the boundary.
 */
export async function readContractBody(
  route: ContractRoute,
  request: Request,
  bodyUsedFix: string,
  truncatedBodyFix?: string,
): Promise<ReadRequestBody> {
  const input = route.input;

  if (input === undefined) return NO_BODY;

  if (request.bodyUsed) {
    throw unexpectedError(
      route,
      new Error(
        `seampact: the body of '${route.id}' was read before the boundary, so its bytes and size are lost. ${bodyUsedFix}`,
      ),
    );
  }

  if (request.body === null) return NO_BODY;

  const refusal = headerRefusal(route, request, input.limitBytes);

  if (refusal !== undefined) {
    await request.body.cancel();

    throw refusal;
  }

  const encoded = { bytes: 0 };
  const bytes = await boundedBytes(route, request.body, request.headers, input.limitBytes, encoded);

  if (truncatedBodyFix !== undefined)
    refuseTruncatedBody(route, request, encoded.bytes, truncatedBodyFix);

  if (bytes.byteLength === 0) return NO_BODY;

  const signed = route.access.kind === "identity" && route.access.signed !== undefined;

  return { body: parsedJson(route, bytes), ...(signed ? { raw: bytes } : {}) };
}

// The refusals the headers alone decide: a declared length over the limit, a charset or a content coding the
// boundary does not read.
function headerRefusal(
  route: ContractRoute,
  request: Request,
  limitBytes: number,
): ContractError | undefined {
  const declaredLength = request.headers.get("content-length");

  if (declaredLength !== null && Number(declaredLength) > limitBytes) {
    return tooLargeError(route, limitBytes);
  }

  const charsetRefused = charsetRefusal(route, request.headers.get("content-type"));

  if (charsetRefused !== undefined) return charsetRefused;

  const coding = contentCoding(request.headers.get("content-encoding"));

  if (coding !== IDENTITY_ENCODING && !canDecode(coding)) {
    return roleError(route, UNSUPPORTED_MEDIA_ROLE);
  }

  return undefined;
}

// Fail closed: a body cut short before the boundary would read as a schema or signature refusal of the client.
function refuseTruncatedBody(
  route: ContractRoute,
  request: Request,
  encodedBytes: number,
  truncatedBodyFix: string,
): void {
  const declaredLength = request.headers.get("content-length");

  if (declaredLength === null || encodedBytes >= Number(declaredLength)) return;

  throw unexpectedError(
    route,
    new Error(
      `seampact: the body of '${route.id}' declared ${declaredLength} bytes and ${encodedBytes} reached the boundary. ${truncatedBodyFix}`,
    ),
  );
}

// The decoded bytes, with the encoded and the decoded counts each bounded by the route's limit; `encoded` receives
// the encoded count.
async function boundedBytes(
  route: ContractRoute,
  body: ByteStream,
  headers: Headers,
  limitBytes: number,
  encoded: { bytes: number },
): Promise<Uint8Array> {
  const coding = contentCoding(headers.get("content-encoding"));
  const counted = body.pipeThrough(encodedCount(limitBytes, encoded));
  const decoded =
    coding === IDENTITY_ENCODING ? counted : (decodedStream(counted, coding) ?? counted);

  try {
    const read = await readCapped(decoded, limitBytes);

    if (read.kind === "complete") return read.bytes;

    await read.whole.cancel();
  } catch (error) {
    if (!(error instanceof EncodedBodyOverLimit))
      throw clientStatusError(route, BAD_REQUEST, error);
  }

  throw tooLargeError(route, limitBytes);
}

function encodedCount(
  limitBytes: number,
  encoded: { bytes: number },
): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      encoded.bytes += chunk.byteLength;

      if (encoded.bytes > limitBytes) controller.error(new EncodedBodyOverLimit());
      else controller.enqueue(chunk);
    },
  });
}

function parsedJson(route: ContractRoute, bytes: Uint8Array): unknown {
  try {
    return JSON.parse(UTF8_KEEPING_BOM.decode(bytes));
  } catch (error) {
    throw clientStatusError(route, BAD_REQUEST, error);
  }
}

function tooLargeError(route: ContractRoute, limitBytes: number): ContractError {
  return roleError(route, PAYLOAD_TOO_LARGE_ROLE, { limitBytes });
}
