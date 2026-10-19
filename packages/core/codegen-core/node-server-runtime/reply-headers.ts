// The header names the boundary's replies own, and the rule that sets them on a reply someone else built: the body
// headers are replaced, the reply's own names win, and `Vary` is merged. Shared by every server profile; copied into
// the generated tree as is.
import type { ContractReply } from "./contract-error.js";

export const ETAG_HEADER = "etag";
/** The prefix of a weak entity tag, which a compressing middleware writes for the boundary's strong one. */
export const WEAK_ETAG_PREFIX = "W/";
export const VARY_HEADER = "vary";
export const CONTENT_LENGTH_HEADER = "content-length";
export const CONTENT_ENCODING_HEADER = "content-encoding";
export const CONTENT_TYPE_HEADER = "content-type";
export const CACHE_CONTROL_HEADER = "cache-control";
export const NO_STORE_DIRECTIVE = "no-store";
// Headers that describe the body: the boundary replaces them, and keeps every other header the app set.
export const BODY_HEADERS: readonly string[] = [
  CONTENT_TYPE_HEADER,
  CONTENT_LENGTH_HEADER,
  CONTENT_ENCODING_HEADER,
  ETAG_HEADER,
];

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
