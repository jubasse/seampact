// The delay a throttler's `Retry-After` names, read from the reply headers it set or the headers its exception
// carries, as the facts of the `rateLimited` role. Copied into the generated tree as is.
import { isPlainObject } from "./plain-object.js";

/** The data of the `rateLimited` role a 429 refusal gives: the delay before a retry, in milliseconds. */
export interface RetryAfterFacts {
  readonly retryAfterMs: number;
}

export const RETRY_AFTER_HEADER = "retry-after";

const MILLISECONDS_PER_SECOND = 1000;
const DELTA_SECONDS = /^\d+$/;
// Every HTTP-date form (IMF-fixdate, RFC 850, asctime) opens with the day name; `Date.parse` alone takes `-1` too.
const HTTP_DATE_DAY = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/;

/**
 * The delay of the first usable `Retry-After`: of the reply headers the framework or the throttler already set, else
 * of the exception's own headers (`headers`, or `getDefaultHeaders()` as `@adonisjs/limiter` writes them, or the
 * headers of the reply a Hono `HTTPException` holds). Undefined when none holds delta-seconds or an HTTP-date.
 */
export function retryAfterFacts(
  error: unknown,
  replyHeaderValues: readonly string[],
): RetryAfterFacts | undefined {
  const now = Date.now();

  for (const value of [...replyHeaderValues, ...exceptionRetryAfterValues(error)]) {
    const retryAfterMs = retryAfterMilliseconds(value, now);

    if (retryAfterMs !== undefined) return { retryAfterMs };
  }

  return undefined;
}

/** A `Retry-After` value in milliseconds from `now`: delta-seconds, or an HTTP-date never before now. */
export function retryAfterMilliseconds(value: string, now: number): number | undefined {
  const trimmed = value.trim();

  if (DELTA_SECONDS.test(trimmed)) return Number(trimmed) * MILLISECONDS_PER_SECOND;

  const date = HTTP_DATE_DAY.test(trimmed) ? Date.parse(trimmed) : Number.NaN;

  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

function exceptionRetryAfterValues(error: unknown): string[] {
  if (!isPlainObject(error) && !(error instanceof Error)) return [];

  const heldReply: unknown = Reflect.get(error, "res");

  if (heldReply instanceof Response) return headerValues(heldReply.headers);

  const headers: unknown = Reflect.get(error, "headers");

  if (headers !== undefined) return headerValues(headers);

  const defaultHeaders: unknown = Reflect.get(error, "getDefaultHeaders");

  return typeof defaultHeaders === "function"
    ? headerValues(Reflect.apply(defaultHeaders, error, []))
    : [];
}

// A header holder as exceptions carry one: Web `Headers`, or an object of names to a string or number.
function headerValues(headers: unknown): string[] {
  if (headers instanceof Headers) {
    const value = headers.get(RETRY_AFTER_HEADER);

    return value === null ? [] : [value];
  }

  if (!isPlainObject(headers)) return [];

  return Object.entries(headers)
    .filter(([name]) => name.toLowerCase() === RETRY_AFTER_HEADER)
    .flatMap(([, value]) => headerValueTexts(value));
}

/** A header value as a framework returns it (a string, a number or a list of them), as its text values. */
export function headerValueTexts(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(headerValueTexts);

  return typeof value === "string" || typeof value === "number" ? [String(value)] : [];
}
