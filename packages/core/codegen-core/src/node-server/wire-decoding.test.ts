import { describe, expect, test } from "vitest";
import {
  decodeQueryMembers,
  type ParamRule,
  withQueryMember,
} from "../../node-server-runtime/wire-decoding.js";

const RULES: readonly ParamRule[] = [
  { name: "sort", decoding: "list" },
  { name: "limit", decoding: "number" },
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

  test("an empty list is no item, a repeated member is the list of its values", () => {
    expect(decodeQueryMembers(RULES, "sort=&limit=1&limit=2")).toEqual({ sort: [], limit: [1, 2] });
  });

  test("the next page link keeps every other member as received", () => {
    expect(withQueryMember("sort=a%2Cb,c&cursor=old&q=x+y", "cursor", "n/1")).toBe(
      "sort=a%2Cb,c&q=x+y&cursor=n%2F1",
    );
  });
});
