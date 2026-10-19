// The contract's part of step 1 (ADR 0012): the route's own body limit and its media type, checked once the
// platform's parser has read the body within the app-wide limit. Copied into the generated tree as is.
import {
  type ContractError,
  PAYLOAD_TOO_LARGE_ROLE,
  roleError,
  unexpectedError,
} from "./contract-error.js";
import { type ContractRequest, type ContractRoute, headerValue } from "./contract-route.js";

const UNSUPPORTED_MEDIA_ROLE = "unsupportedMediaType";
const CHARSET_PARAMETER = "charset=";

/** The content coding of a body sent as is. */
export const IDENTITY_ENCODING = "identity";

/** The setup fixes a framework placement names in its logs; the shared checks know no framework. */
export interface PlatformFixes {
  /** How to make the raw body of a signed route reach the boundary. */
  readonly rawBody: string;
  /** How to make the size of a request body known to the boundary. */
  readonly bodySize: string;
}

/** What the platform reports about the body it read. */
export interface ReadBody {
  /** The parsed byte count recorded by the platform's parser hook, when it ran. */
  readonly recordedBytes?: number;
  readonly fixes: PlatformFixes;
}

/** The refusal of step 1's contract checks, or undefined when the request passes them. */
export function transportRefusal(
  route: ContractRoute,
  request: ContractRequest,
  readBody: ReadBody,
): ContractError | undefined {
  return mediaTypeRefusal(route, request) ?? bodySizeRefusal(route, request, readBody);
}

/** Step 1's media-type check alone, for a placement that runs it before the body is read. */
export function mediaTypeRefusal(
  route: ContractRoute,
  request: ContractRequest,
): ContractError | undefined {
  const input = route.input;

  if (input === undefined || !hasBody(request)) return undefined;

  const contentType = headerValue(request.headers, "content-type");

  if (contentType === undefined || !isMediaOf(contentType, input.media)) {
    return roleError(route, UNSUPPORTED_MEDIA_ROLE);
  }

  return undefined;
}

/** Step 1's body-limit check alone, once the platform's parser has read the body. */
export function bodySizeRefusal(
  route: ContractRoute,
  request: ContractRequest,
  readBody: ReadBody,
): ContractError | undefined {
  const input = route.input;

  if (input === undefined || !hasBody(request)) return undefined;

  const size = bodySize(request, readBody);

  if (size === undefined) {
    return unexpectedError(
      route,
      new Error(
        `seampact: operation '${route.id}' got a body whose size neither the raw body, the recorded byte count nor ` +
          `Content-Length gives. ${readBody.fixes.bodySize}`,
      ),
    );
  }

  if (size > input.limitBytes)
    return roleError(route, PAYLOAD_TOO_LARGE_ROLE, { limitBytes: input.limitBytes });

  return undefined;
}

function hasBody(request: ContractRequest): boolean {
  const length = headerValue(request.headers, "content-length");

  return (
    (length !== undefined && length !== "0") ||
    headerValue(request.headers, "transfer-encoding") !== undefined
  );
}

// The parsed bytes first, since the parser inflates a compressed body; Content-Length only for an identity body.
function bodySize(request: ContractRequest, readBody: ReadBody): number | undefined {
  if (request.rawBody !== undefined) return request.rawBody.byteLength;

  if (readBody.recordedBytes !== undefined) return readBody.recordedBytes;

  const encoding = headerValue(request.headers, "content-encoding");
  const length = headerValue(request.headers, "content-length");

  if (
    (encoding === undefined || encoding.toLowerCase() === IDENTITY_ENCODING) &&
    length !== undefined
  ) {
    return Number(length);
  }

  return undefined;
}

// The declared media type exactly: a `+json` suffix (`application/merge-patch+json`) is another media type.
function isMediaOf(contentType: string, media: string): boolean {
  const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  return essence === media;
}

/** The lowercase `charset` parameter of a Content-Type value, without quotes; undefined when it has none. */
export function charsetOf(contentType: string | null | undefined): string | undefined {
  const parameter = contentType
    ?.split(";")
    .slice(1)
    .map((part) => part.trim().toLowerCase())
    .find((part) => part.startsWith(CHARSET_PARAMETER));

  return parameter?.slice(CHARSET_PARAMETER.length).replace(/^"|"$/g, "");
}
