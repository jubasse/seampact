// The verdict rules of the outgoing response check (ADR 0016 "The outgoing response check"), shared by every server
// profile: whoever writes the reply, an undeclared status, a framework ETag or 304, or an error body outside the
// api's format or codes is a violation, handled by the `responses` mode. Copied into the generated tree as is.
import { type BoundaryContext, unexpectedContext } from "./boundary-context.js";
import { reportUnexpected } from "./boundary-hooks.js";
import { type ContractReply, isPlainObject } from "./contract-error.js";
import type { ReportedRequest } from "./error-reply.js";
import { NO_STORE_DIRECTIVE } from "./reply-headers.js";

/** The longest error body the check holds to read its code; a longer one is a violation. */
export const MAX_CHECKED_ERROR_BODY_BYTES = 65536;

const NOT_MODIFIED = 304;
const LIST_SHAPES: ReadonlySet<string> = new Set(["list", "page"]);
const TABLE_SHAPE = "table";
const UTF8_KEEPING_BOM = new TextDecoder("utf-8", { ignoreBOM: true });

/** What `onUnexpectedError` receives for a reply outside the contract when no exception is known. */
export interface ViolatingReply {
  readonly status: number;
  readonly headers: readonly (readonly [name: string, value: string])[];
  readonly body: Uint8Array;
  readonly violation: string;
}

/** What the check does with a reply the boundary did not write, once its status is known. */
export type StatusVerdict =
  | { readonly kind: "pass" }
  | { readonly kind: "hold"; readonly holdReason: HoldReason }
  | { readonly kind: "violation"; readonly reason: string };

/** Why a body is held: an error body to read its code, a success body to validate it. */
export type HoldReason = "error" | "success";

/** The verdict on a status the app wrote: declared and checked, declared and passed, or a violation. */
export function statusVerdict(
  context: BoundaryContext,
  status: number,
  cacheControlHeader: string,
): StatusVerdict {
  if (status === NOT_MODIFIED)
    return { kind: "violation", reason: "a 304 the boundary did not write" };

  const success = context.route.responses.find((entry) => entry.status === status);

  if (success !== undefined) {
    if (context.route.cache?.noStore === true && !hasNoStoreDirective(cacheControlHeader)) {
      return {
        kind: "violation",
        reason: `a ${status} reply without Cache-Control: no-store, which the operation requires`,
      };
    }

    return context.bodyValidation && success.itemValidator !== undefined
      ? { kind: "hold", holdReason: "success" }
      : { kind: "pass" };
  }

  if (Object.values(context.route.errors).some((entry) => entry.status === status)) {
    return { kind: "hold", holdReason: "error" };
  }

  return { kind: "violation", reason: `the undeclared status ${status}` };
}

/** Logs a violation that goes out as written under `responses: warn`; the check logs it once per reply. */
export function warnViolation(context: BoundaryContext, reason: string): void {
  console.warn(
    `seampact: contract violation on operation '${context.route.id}': ${reason}; sent as written (responses: warn).`,
  );
}

/**
 * Reports a violation replaced by a 500 under `responses: strict`: the kept exception, else the violating reply, to
 * `onUnexpectedError`, or to the log when no hook is registered.
 */
export async function reportViolation(
  context: BoundaryContext,
  request: ReportedRequest,
  reason: string,
  reply: ContractReply,
): Promise<void> {
  const where = unexpectedContext(context, request.method, request.path);
  const reported: unknown =
    context.unclaimedException ?? ({ ...reply, violation: reason } satisfies ViolatingReply);

  if (context.hooks.onUnexpectedError === undefined) {
    console.error(
      `seampact: contract violation on operation '${context.route.id}': ${reason}; replaced by a 500 (responses: strict).`,
      context.unclaimedException ?? "",
    );
  }

  await reportUnexpected(context.hooks, reported, where);
}

/** The violation of an error body longer than the check holds. */
export function oversizedErrorBodyViolation(maxBytes: number): string {
  return `an error body over ${maxBytes} bytes`;
}

/** The violation of a held body longer than the check holds once decoded. */
export function oversizedDecodedBodyViolation(maxBytes: number): string {
  return `an error body over ${maxBytes} bytes once decoded`;
}

/** The violation of a held body in a content coding the check has no decoder for. */
export function unreadableEncodingViolation(encoding: string): string {
  return `a body in the content encoding '${encoding}', which the check cannot read`;
}

/** The violation of a held body its declared content coding does not decode. */
export function undecodableBodyViolation(encoding: string): string {
  return `a body that does not decode as '${encoding}'`;
}

/** The violation of a held error body, from its status and media type, or undefined when it is in the contract. */
export function errorBodyViolation(
  context: BoundaryContext,
  status: number,
  contentTypeHeader: string,
  cacheControlHeader: string,
  body: Uint8Array,
): string | undefined {
  const contentType = contentTypeHeader.split(";")[0]?.trim();

  if (contentType !== context.api.format.media)
    return `an error body of media '${contentType}', not the api's format`;

  const parsed = parseJson(body);
  const code = isPlainObject(parsed) ? parsed[context.api.format.codeMember] : undefined;

  if (typeof code !== "string") return "an error body without a code in the api's format";

  const entry = Object.hasOwn(context.route.errors, code) ? context.route.errors[code] : undefined;

  if (entry === undefined || entry.status !== status) {
    return `the code '${code}' with status ${status}, which the operation does not declare`;
  }

  if (entry.noStore === true && !hasNoStoreDirective(cacheControlHeader)) {
    return `the code '${code}' without Cache-Control: no-store, which its sensitive params require`;
  }

  return undefined;
}

// `private, no-store` carries the directive; a header value that lacks it does not.
function hasNoStoreDirective(cacheControlHeader: string): boolean {
  return cacheControlHeader
    .split(",")
    .some((directive) => directive.trim().toLowerCase() === NO_STORE_DIRECTIVE);
}

/** The violation of a held success body against its output schema, or undefined when it validates. */
export async function successBodyViolation(
  context: BoundaryContext,
  status: number,
  body: Uint8Array,
): Promise<string | undefined> {
  const response = context.route.responses.find((entry) => entry.status === status);
  const validator = response?.itemValidator;

  if (response === undefined || validator === undefined) return undefined;

  const items = bodyItems(parseJson(body), response.shape);

  if (typeof items === "string") return `a ${status} ${response.shape} body that is not ${items}`;

  for (const item of items) {
    const result = await validator["~standard"].validate(item);

    if (result.issues !== undefined)
      return `a ${status} body that fails its output schema: ${result.issues[0]?.message ?? ""}`;
  }

  return undefined;
}

// The items a body holds by its shape: a list or page is a JSON array, a table a JSON object keyed by item id
// (ADR 0002 section 6), any other shape one item. A body outside its shape gives what it should have been.
function bodyItems(parsed: unknown, shape: string): readonly unknown[] | string {
  if (LIST_SHAPES.has(shape)) return Array.isArray(parsed) ? parsed : "a JSON array";

  if (shape === TABLE_SHAPE) {
    return isPlainObject(parsed) ? Object.values(parsed) : "a JSON object keyed by item id";
  }

  return [parsed];
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(UTF8_KEEPING_BOM.decode(body));
  } catch {
    // Not JSON: the caller reports the body as outside the format.
    return undefined;
  }
}
