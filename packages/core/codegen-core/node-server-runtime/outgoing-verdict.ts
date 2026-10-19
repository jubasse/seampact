// The verdict rules of the outgoing response check (ADR 0016 "The outgoing response check"), shared by every server
// profile: whoever writes the reply, an undeclared status, a framework ETag or 304, or an error body outside the
// api's format or codes is a violation, handled by the `responses` mode. Copied into the generated tree as is.
import type { BoundaryContext } from "./boundary-context.js";
import { type ContractReply, isPlainObject } from "./contract-error.js";

/** The longest error body the check holds to read its code; a longer one is a violation. */
export const MAX_CHECKED_ERROR_BODY_BYTES = 65536;

export const ETAG_HEADER = "etag";
export const VARY_HEADER = "vary";
export const CONTENT_LENGTH_HEADER = "content-length";
export const CONTENT_ENCODING_HEADER = "content-encoding";
export const CONTENT_TYPE_HEADER = "content-type";
// Headers that describe the body: the boundary replaces them, and keeps every other header the app set.
export const BODY_HEADERS: readonly string[] = [
  CONTENT_TYPE_HEADER,
  CONTENT_LENGTH_HEADER,
  CONTENT_ENCODING_HEADER,
  ETAG_HEADER,
];

const NOT_MODIFIED = 304;
const LIST_SHAPES: ReadonlySet<string> = new Set(["list", "table", "page"]);
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
export function statusVerdict(context: BoundaryContext, status: number): StatusVerdict {
  if (status === NOT_MODIFIED)
    return { kind: "violation", reason: "a 304 the boundary did not write" };

  const success = context.route.responses.find((entry) => entry.status === status);

  if (success !== undefined) {
    return context.bodyValidation && success.itemValidator !== undefined
      ? { kind: "hold", holdReason: "success" }
      : { kind: "pass" };
  }

  if (Object.values(context.route.errors).some((entry) => entry.status === status)) {
    return { kind: "hold", holdReason: "error" };
  }

  return { kind: "violation", reason: `the undeclared status ${status}` };
}

/** The reply's headers grouped by lowercase name, in their order. */
export function groupedHeaders(headers: ContractReply["headers"]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const [name, value] of headers) {
    const lowerName = name.toLowerCase();

    grouped.set(lowerName, [...(grouped.get(lowerName) ?? []), value]);
  }

  return grouped;
}

/** The `Vary` names already set followed by the added ones, each once whatever its case. */
export function mergedVary(current: readonly string[], added: readonly string[]): string {
  const names: string[] = [];

  for (const value of [...current, ...added]) {
    for (const name of value.split(",")) {
      const trimmed = name.trim();

      if (trimmed !== "" && !names.some((known) => known.toLowerCase() === trimmed.toLowerCase())) {
        names.push(trimmed);
      }
    }
  }

  return names.join(", ");
}

/** The violation of a held error body, from its status and media type, or undefined when it is in the contract. */
export function errorBodyViolation(
  context: BoundaryContext,
  status: number,
  contentTypeHeader: string,
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

  return undefined;
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

  const parsed = parseJson(body);
  const isList = LIST_SHAPES.has(response.shape);

  if (isList && !Array.isArray(parsed))
    return `a ${status} ${response.shape} body that is not a JSON array`;

  const items = isList && Array.isArray(parsed) ? parsed : [parsed];

  for (const item of items) {
    const result = await validator["~standard"].validate(item);

    if (result.issues !== undefined)
      return `a ${status} body that fails its output schema: ${result.issues[0]?.message ?? ""}`;
  }

  return undefined;
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(UTF8_KEEPING_BOM.decode(body));
  } catch {
    // Not JSON: the caller reports the body as outside the format.
    return undefined;
  }
}
