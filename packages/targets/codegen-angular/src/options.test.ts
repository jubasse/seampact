import { expect, test } from "vitest";
import { parseAngularQueryOptions } from "./options.js";

function refusalCodes(raw: unknown): string[] {
  const outcome = parseAngularQueryOptions(raw);

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

test("`query: fetch` parses without refresh or infinite queries, `errors` read", () => {
  expect(parseAngularQueryOptions({ query: "fetch", errors: "data" })).toEqual({
    status: "parsed",
    options: {
      query: "fetch",
      errors: "data",
      invalidate: "off",
      staleTime: "off",
      infinite: "off",
    },
  });
});

test("a missing or library `query`, an unknown key and the cache options are refused by name", () => {
  expect(refusalCodes({})).toEqual(["options.query.missing"]);
  expect(refusalCodes({ query: "tanstack" })).toEqual(["options.query.invalid"]);
  expect(refusalCodes(null)).toEqual(["options.invalid"]);
  expect(refusalCodes({ query: "fetch", useClientDirective: "off" })).toEqual(["options.unknown"]);
  expect(
    refusalCodes({ query: "fetch", staleTime: "off", invalidate: "resource", keys: { root: "t" } }),
  ).toEqual([
    "options.staleTime.unsupported",
    "options.invalidate.unsupported",
    "options.keys.root.unsupported",
  ]);
});

test("`state` is refused by name until it is generated, an unknown value as invalid", () => {
  const outcome = parseAngularQueryOptions({ query: "fetch", state: "ngrx-signals" });

  expect(outcome).toMatchObject({
    status: "refused",
    refusals: [{ code: "options.state.unsupported", member: "/state" }],
  });
  expect(refusalCodes({ query: "fetch", state: "ngrx" })).toEqual(["options.state.unsupported"]);
  expect(refusalCodes({ query: "fetch", state: "redux" })).toEqual(["options.state.invalid"]);
});

test("a cache option's fix offers no library when plain fetch is the only value", () => {
  const outcome = parseAngularQueryOptions({ query: "fetch", infinite: "on" });

  expect(outcome).toMatchObject({ refusals: [{ fix: "Drop 'infinite'." }] });
});
