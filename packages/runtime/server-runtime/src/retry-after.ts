// The delay a throttler's `Retry-After` names, read from the reply headers it set or the headers its exception
// carries, as the facts of the `rateLimited` role.
import { isPlainObject } from "./plain-object.js";
import { runtimeLog } from "./runtime-logger.js";

/** The data of the `rateLimited` role a 429 refusal gives: the delay before a retry, in milliseconds. */
export interface RetryAfterFacts {
  readonly retryAfterMs: number;
}

export const RETRY_AFTER_HEADER = "retry-after";

const MILLISECONDS_PER_SECOND = 1000;
// The schema maximum of `retryAfterMs`: a longer delay is capped, never written as Infinity.
const MAXIMUM_DELAY_MS = Number.MAX_SAFE_INTEGER;
const DELTA_SECONDS = /^\d+$/;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_DAYS = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const LONG_DAYS = "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
const MONTH_NAMES = MONTHS.join("|");
const CLOCK = "(\\d{2}):(\\d{2}):(\\d{2})";

// The three HTTP-date forms of RFC 9110, each read as UTC; the capture groups are day, month, year, h, m, s.
const IMF_FIXDATE = new RegExp(
  `^(?:${SHORT_DAYS}), (\\d{2}) (${MONTH_NAMES}) (\\d{4}) ${CLOCK} GMT$`,
);
const RFC_850_DATE = new RegExp(
  `^(?:${LONG_DAYS}), (\\d{2})-(${MONTH_NAMES})-(\\d{2}) ${CLOCK} GMT$`,
);
const ASCTIME_DATE = new RegExp(
  `^(?:${SHORT_DAYS}) (${MONTH_NAMES}) +(\\d{1,2}) ${CLOCK} (\\d{4})$`,
);

const RFC_850_FUTURE_LIMIT_YEARS = 50;
const CENTURY = 100;

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

/**
 * A `Retry-After` value in milliseconds from `now`: delta-seconds, or an HTTP-date never before now, capped at the
 * schema maximum. Undefined for anything else, including a date `Date.parse` alone would take.
 */
export function retryAfterMilliseconds(value: string, now: number): number | undefined {
  const trimmed = value.trim();

  if (DELTA_SECONDS.test(trimmed)) {
    return Math.min(Number(trimmed) * MILLISECONDS_PER_SECOND, MAXIMUM_DELAY_MS);
  }

  const date = httpDateMilliseconds(trimmed, now);

  return date === undefined ? undefined : Math.min(Math.max(0, date - now), MAXIMUM_DELAY_MS);
}

function httpDateMilliseconds(value: string, now: number): number | undefined {
  const imf = IMF_FIXDATE.exec(value);

  if (imf !== null) return utcMilliseconds(imf[3], imf[2], imf[1], imf.slice(4));

  const rfc850 = RFC_850_DATE.exec(value);

  if (rfc850 !== null) {
    return utcMilliseconds(rfc850Year(rfc850[3], now), rfc850[2], rfc850[1], rfc850.slice(4));
  }

  const asctime = ASCTIME_DATE.exec(value);

  return asctime === null
    ? undefined
    : utcMilliseconds(asctime[6], asctime[1], asctime[2], asctime.slice(3, 6));
}

// RFC 9110: a two-digit year more than 50 years ahead of now means the past century.
function rfc850Year(twoDigits: string | undefined, now: number): string {
  const currentYear = new Date(now).getUTCFullYear();
  const year = Math.floor(currentYear / CENTURY) * CENTURY + Number(twoDigits);

  return String(year - currentYear > RFC_850_FUTURE_LIMIT_YEARS ? year - CENTURY : year);
}

// The date as UTC milliseconds; undefined when a field overflows (31 Feb, 25:00) so no date is invented.
function utcMilliseconds(
  year: string | undefined,
  month: string | undefined,
  day: string | undefined,
  clock: readonly (string | undefined)[],
): number | undefined {
  const [hour, minute, second] = clock.map(Number);
  const monthIndex = MONTHS.indexOf(month ?? "");

  if (year === undefined || day === undefined || monthIndex < 0) return undefined;

  if (hour === undefined || minute === undefined || second === undefined) return undefined;

  const milliseconds = Date.UTC(Number(year), monthIndex, Number(day), hour, minute, second);
  const date = new Date(milliseconds);
  const exact =
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;

  return exact ? milliseconds : undefined;
}

function exceptionRetryAfterValues(error: unknown): string[] {
  if (!isPlainObject(error) && !(error instanceof Error)) return [];

  const heldReply: unknown = Reflect.get(error, "res");

  if (heldReply instanceof Response) return headerValues(heldReply.headers);

  const carriedValues = headerValues(Reflect.get(error, "headers"));

  return carriedValues.length > 0 ? carriedValues : defaultHeaderValues(error);
}

// The headers `getDefaultHeaders()` returns, as `@adonisjs/limiter` writes them; a throwing call is logged, not fatal.
function defaultHeaderValues(error: object): string[] {
  const defaultHeaders: unknown = Reflect.get(error, "getDefaultHeaders");

  if (typeof defaultHeaders !== "function") return [];

  try {
    return headerValues(Reflect.apply(defaultHeaders, error, []));
  } catch (failure) {
    runtimeLog.error("seampact: reading the exception's getDefaultHeaders() failed", failure);

    return [];
  }
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
