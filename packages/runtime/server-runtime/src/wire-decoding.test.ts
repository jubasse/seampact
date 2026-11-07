import { describe, expect, test } from "vitest";
import { decodeQueryMembers, type ParamRule, withQueryMember } from "./wire-decoding.js";

const RULES: readonly ParamRule[] = [
  { name: "sort", decoding: "list" },
  { name: "limit", decoding: "number" },
  { name: "tag", decoding: "repeatedList" },
  { name: "score", decoding: "repeatedList", items: "number" },
  { name: "flags", decoding: "list", items: "boolean" },
];

describe("query decoding", () => {
  test("an encoded comma stays inside its list item", () => {
    expect(decodeQueryMembers(RULES, "sort=a%2Cb,c")).toEqual({ sort: ["a,b", "c"] });
  });

  test("names and values decode as a form", () => {
    expect(decodeQueryMembers(RULES, "sort=a+b,%2B&limit=10&extra=x%20y&&flag")).toEqual({
      sort: ["a b", "+"],
      limit: 10,
      extra: "x y",
      flag: "",
    });
  });

  test("a component without escapes or plus decodes as the form parser does", () => {
    const rawQuery = "plain=abc&equals=a=b&accented=été&empty=&=nameless";
    const formParsed = Object.fromEntries(new URLSearchParams(rawQuery));

    expect(decodeQueryMembers([], rawQuery)).toEqual(formParsed);
  });

  test("an empty list is no item, a repeated member is the list of its values", () => {
    expect(decodeQueryMembers(RULES, "sort=&limit=1&limit=2")).toEqual({ sort: [], limit: [1, 2] });
  });

  test("a repeated list is the list of its values, one item per key, even when sent once", () => {
    expect(decodeQueryMembers(RULES, "tag=a&tag=b")).toEqual({ tag: ["a", "b"] });
    expect(decodeQueryMembers(RULES, "tag=a")).toEqual({ tag: ["a"] });
    expect(decodeQueryMembers(RULES, "limit=1")).toEqual({ limit: 1 });
  });

  test("a repeated list keeps commas inside its items and decodes each as a form", () => {
    expect(decodeQueryMembers(RULES, "tag=a,b&tag=c+d%2Ce&tag=")).toEqual({
      tag: ["a,b", "c d,e", ""],
    });
  });

  test("each list item is decoded by its type, and one that does not decode stays text", () => {
    expect(decodeQueryMembers(RULES, "score=1&score=2.5&score=ten&flags=true,false,maybe")).toEqual(
      {
        score: [1, 2.5, "ten"],
        flags: [true, false, "maybe"],
      },
    );
  });

  test("the next page link keeps every other member as received", () => {
    expect(withQueryMember("sort=a%2Cb,c&cursor=old&q=x+y", "cursor", "n/1")).toBe(
      "sort=a%2Cb,c&q=x+y&cursor=n%2F1",
    );
  });

  test("the next page link percent-encodes bytes outside the query set and keeps escapes and commas", () => {
    expect(withQueryMember('q=a>b&r="x"&s=a%2Cb,c&t=100%&cursor=old', "cursor", "n")).toBe(
      "q=a%3Eb&r=%22x%22&s=a%2Cb,c&t=100%25&cursor=n",
    );
  });
});
