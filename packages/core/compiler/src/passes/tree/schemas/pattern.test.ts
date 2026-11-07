import { describe, expect, test } from "vitest";
import { treeSchemasNormalizePattern } from "./pattern.js";

const DOT = "[^\\u000A\\u000D\\u0085\\u2028-\\u2029]";

describe("portable patterns", () => {
  test.each([
    ["^[A-Z]{2}$", "^[A-Z]{2}$"],
    ["^-?(0|[1-9][0-9]*)$", "^-?(0|[1-9][0-9]*)$"],
    ["a.b", `a${DOT}b`],
    ["\\d+", "[0-9]+"],
    ["\\W", "[^0-9A-Z_a-z]"],
    ["\\s", "[\\u0009-\\u000D ]"],
    ["[\\d_-]", "[\\-0-9_]"],
    ["[a\\D]", "[\\u0000-/:-\\u{10FFFF}]"],
    ["[z-a0-9a-z]", null],
    ["(?:ab|cd){1,3}", "(?:ab|cd){1,3}"],
    ["x{2,}", "x{2,}"],
    ["\\{\\}\\]", "\\{\\}\\]"],
  ])("%s normalises to %s", (source, normalized) => {
    const result = treeSchemasNormalizePattern(source);

    if (normalized === null) expect(result.ok).toBe(false);
    else expect(result).toEqual({ ok: true, normalized });
  });

  test.each([
    ["(a)\\1", "only a metacharacter"],
    ["(?=a)", "lookarounds"],
    ["(?<n>a)", "named groups"],
    ["(?i)a", "inline flags"],
    ["a*?", "lazy"],
    ["a++", "possessive"],
    ["\\bword", "not portable"],
    ["\\p{L}", "not portable"],
    ["a{", "repetition"],
    ["a}", "escaped"],
    ["a]", "escaped"],
    ["[a-c-e]", "'-'"],
    ["[]", "empty class"],
    ["*a", "nothing to repeat"],
    ["^*", "anchor"],
    ["a{1001}", "above 1000"],
    ["a{3,1}", "reversed"],
    ["(a", "ends inside"],
    ["a)", "not expected"],
  ])("%s is refused (%s)", (source, reason) => {
    const result = treeSchemasNormalizePattern(source);

    expect(result.ok).toBe(false);

    if (!result.ok) expect(result.message).toContain(reason);
  });

  test.each([
    ["(a+)+", "trailing repetition"],
    ["^(a*b?)*$", "trailing repetition"],
    ["(?:x{2,5}){3}", "trailing repetition"],
    ["^(?:.*,)+$", "trailing repetition"],
    ["^(a+a)+$", "trailing repetition"],
    ["(a|ab)*", "branches can start with the same character"],
    ["(a|a)+", "branches can start with the same character"],
    ["(?:a?b|b)*", "branches can start with the same character"],
    ["(?:\\d|[0-5]x){2,}", "branches can start with the same character"],
    ["((a|ab))*", "branches can start with the same character"],
    ["^((a|aa)b?)*$", "branches can start with the same character"],
    ["^(?:b?(a|aa))+$", "branches can start with the same character"],
    ["^(?:(a|aa)|c)*$", "branches can start with the same character"],
  ])("%s is refused as backtracking exponentially (%s)", (source, reason) => {
    const result = treeSchemasNormalizePattern(source);

    expect(result).toMatchObject({ ok: false, fix: expect.stringContaining("A45") });

    if (!result.ok) expect(result.message).toContain(reason);
  });

  test.each([
    "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    "(\\d+,)*",
    "^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,}$",
    "^([a-z0-9]+-)*$",
    "^(\\d{3}-)?\\d{4}$",
    "(a+)?",
    "(?:ab{3})*",
    "(?:a|b)*",
    "(?:x|a?b)",
    "(?:^|,)a",
    "^(?:(a|ab)c)*$",
    "^(?:x(a|aa))*$",
  ])("%s repeats nothing that can backtrack exponentially", (source) => {
    expect(treeSchemasNormalizePattern(source).ok).toBe(true);
  });

  test("deeply nested groups are refused, not left to overflow the stack", () => {
    const result = treeSchemasNormalizePattern(`${"(".repeat(5000)}a${")".repeat(5000)}`);

    expect(result.ok).toBe(false);

    if (!result.ok) expect(result.message).toContain("nested");
  });
});
