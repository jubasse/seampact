// Which replies an idempotency record keeps for a replay: not a server error, which the client may retry, and not a
// reply its sender marked `no-store`, which must not be kept. Copied into the generated tree as is.
import {
  CACHE_CONTROL_HEADER,
  groupedHeaders,
  hasNoStoreDirective,
  type ReplyHeaderPairs,
} from "./reply-headers.js";

const SERVER_ERROR_FLOOR = 500;

/** The part of a contract reply the rule reads. */
export interface SettledReply {
  readonly status: number;
  readonly headers: ReplyHeaderPairs;
}

/** True when the reply is kept for a replay; false when the record is abandoned, as after a 5xx. */
export function isKeptForReplay(reply: SettledReply): boolean {
  if (reply.status >= SERVER_ERROR_FLOOR) return false;

  const cacheControl = groupedHeaders(reply.headers).get(CACHE_CONTROL_HEADER) ?? [];

  return !hasNoStoreDirective(cacheControl.join(","));
}
