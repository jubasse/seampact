import { afterEach, describe, expect, test } from "vitest";
import { retryAfterFacts, retryAfterMilliseconds } from "./retry-after.js";

const NOW = Date.parse("Tue, 27 Oct 2026 10:00:00 GMT");

describe("a Retry-After value", () => {
  test.each([
    ["delta-seconds", "2", 2000],
    ["delta-seconds with spaces", " 30 ", 30_000],
    ["an HTTP-date ahead", "Tue, 27 Oct 2026 10:00:05 GMT", 5000],
    ["an HTTP-date passed", "Tue, 27 Oct 2026 09:59:00 GMT", 0],
    ["a negative number", "-1", undefined],
    ["a fraction", "1.5", undefined],
    ["text", "soon", undefined],
    ["a 13-digit delay, capped at the schema maximum", "9007199254741", Number.MAX_SAFE_INTEGER],
    ["a 400-digit delay, capped and never Infinity", "9".repeat(400), Number.MAX_SAFE_INTEGER],
    ["a day name with a day number", "Mon 1", undefined],
    ["a day name with a word", "Monkey 5", undefined],
    ["an RFC 850 date ahead", "Tuesday, 27-Oct-26 10:00:05 GMT", 5000],
    ["an asctime date ahead", "Tue Oct 27 10:00:05 2026", 5000],
    ["an asctime date with a padded day", "Wed Nov  4 10:00:00 2026", 8 * 86_400_000],
    ["an impossible date", "Tue, 31 Feb 2026 10:00:05 GMT", undefined],
  ])("%s", (_, value, expected) => {
    expect(retryAfterMilliseconds(value, NOW)).toBe(expected);
  });

  describe("an asctime date, read as UTC under any server zone", () => {
    const originalZone = process.env.TZ;

    afterEach(() => {
      if (originalZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalZone;
    });

    test.each(["UTC", "America/New_York", "Asia/Dubai"])("%s", (zone) => {
      process.env.TZ = zone;

      expect(retryAfterMilliseconds("Tue Oct 27 10:00:05 2026", NOW)).toBe(5000);
    });
  });
});

describe("the facts of a refusal", () => {
  test("the reply's header comes before the exception's", () => {
    const error = Object.assign(new Error("throttled"), { headers: { "Retry-After": "9" } });

    expect(retryAfterFacts(error, ["1"])).toEqual({ retryAfterMs: 1000 });
  });

  test.each([
    ["a headers object", { headers: { "retry-after": 3 } }],
    ["Web headers", { headers: new Headers({ "retry-after": "3" }) }],
    ["a held reply", { res: new Response(null, { headers: { "retry-after": "3" } }) }],
    ["default headers", { getDefaultHeaders: () => ({ "Retry-After": 3 }) }],
  ])("an exception with %s", (_, carried) => {
    expect(retryAfterFacts(Object.assign(new Error("throttled"), carried), [])).toEqual({
      retryAfterMs: 3000,
    });
  });

  test("no usable header gives no facts", () => {
    expect(retryAfterFacts(new Error("throttled"), ["later"])).toBeUndefined();
  });
});
