import { describe, expect, test } from "vitest";
import { retryAfterFacts, retryAfterMilliseconds } from "../../node-server-runtime/retry-after.js";

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
  ])("%s", (_, value, expected) => {
    expect(retryAfterMilliseconds(value, NOW)).toBe(expected);
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
