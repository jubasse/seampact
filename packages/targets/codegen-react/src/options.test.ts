import { clientTargetCompatibility } from "@seampact/spec/compatibility";
import { expect, test } from "vitest";
import { parseReactQueryOptions, QUERY_LIBRARIES } from "./options.js";

function refusalCodes(raw: unknown): string[] {
  const outcome = parseReactQueryOptions(raw);

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

test("only `query` is required; every switch has its default", () => {
  expect(parseReactQueryOptions({ query: "tanstack" })).toEqual({
    status: "parsed",
    options: {
      query: "tanstack",
      errors: "throw",
      invalidate: "resource",
      staleTime: "off",
      infinite: "on",
      useClientDirective: "on",
    },
  });
});

test("every switch and `keys.root` are read", () => {
  const outcome = parseReactQueryOptions({
    query: "tanstack",
    errors: "data",
    invalidate: "off",
    staleTime: "contract",
    infinite: "off",
    useClientDirective: "off",
    keys: { root: "tasksApi" },
  });

  expect(outcome).toEqual({
    status: "parsed",
    options: {
      query: "tanstack",
      errors: "data",
      invalidate: "off",
      staleTime: "contract",
      infinite: "off",
      useClientDirective: "off",
      keysRoot: "tasksApi",
    },
  });
});

test("a missing or unknown `query` is refused by name", () => {
  expect(refusalCodes({})).toEqual(["options.query.missing"]);
  expect(refusalCodes({ query: "apollo" })).toEqual(["options.query.invalid"]);
  expect(refusalCodes(null)).toEqual(["options.invalid"]);
});

test("an unknown key or switch value is refused by name, all at once", () => {
  expect(
    refusalCodes({
      query: "tanstack",
      retry: "contract",
      errors: "log",
      keys: { prefix: "x", root: 1 },
    }),
  ).toEqual([
    "options.unknown",
    "options.errors.invalid",
    "options.unknown",
    "options.keys.root.invalid",
  ]);
  expect(refusalCodes({ query: "tanstack", keys: "tasks" })).toEqual(["options.keys.invalid"]);
});

test("`staleTime: contract` is refused with SWR and RTK, `keys.root` with RTK", () => {
  expect(refusalCodes({ query: "swr", staleTime: "contract" })).toEqual([
    "options.staleTime.unsupported",
  ]);
  expect(refusalCodes({ query: "rtk", staleTime: "contract", keys: { root: "tasks" } })).toEqual([
    "options.staleTime.unsupported",
    "options.keys.root.unsupported",
  ]);
});

test("`query: fetch` refuses the cache options by name and parses without refresh or infinite queries", () => {
  expect(
    refusalCodes({
      query: "fetch",
      staleTime: "off",
      invalidate: "resource",
      infinite: "on",
      keys: { root: "tasks" },
    }),
  ).toEqual([
    "options.staleTime.unsupported",
    "options.invalidate.unsupported",
    "options.infinite.unsupported",
    "options.keys.root.unsupported",
  ]);
  expect(parseReactQueryOptions({ query: "fetch", errors: "data" })).toEqual({
    status: "parsed",
    options: {
      query: "fetch",
      errors: "data",
      invalidate: "off",
      staleTime: "off",
      infinite: "off",
      useClientDirective: "on",
    },
  });
});

test("the compatibility matrix selects a library for every `query` value but `fetch`", () => {
  const selectorValues = clientTargetCompatibility("@seampact/codegen-react").libraries?.map(
    (library) => library.selectedBy?.value,
  );

  expect(new Set(selectorValues)).toEqual(
    new Set(QUERY_LIBRARIES.filter((library) => library !== "fetch")),
  );
});
