// The contract's part of step 1 (ADR 0012): the route's own body limit and its media type, checked once the
// platform's parser has read the body within the app-wide limit. Copied into the generated tree as is.
import { ContractError, codeOfRole, unexpectedError } from "./contract-error.js";
import { type ContractRequest, type ContractRoute, headerValue } from "./contract-route.js";

const PAYLOAD_TOO_LARGE_ROLE = "payloadTooLarge";
const UNSUPPORTED_MEDIA_ROLE = "unsupportedMediaType";
const IDENTITY_ENCODING = "identity";
const JSON_SUFFIX = "+json";

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
  const input = route.input;

  if (input === undefined || !hasBody(request)) return undefined;

  const contentType = headerValue(request.headers, "content-type");

  if (contentType === undefined || !isMediaOf(contentType, input.media)) {
    return roleError(route, UNSUPPORTED_MEDIA_ROLE);
  }

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

function isMediaOf(contentType: string, media: string): boolean {
  const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  return essence === media || (media === "application/json" && essence.endsWith(JSON_SUFFIX));
}

function roleError(route: ContractRoute, role: string, params?: unknown): ContractError {
  const code = codeOfRole(route, role);

  if (code === undefined) {
    return unexpectedError(route, new Error(`operation '${route.id}' declares no ${role} code`));
  }

  return new ContractError(code, params);
}
