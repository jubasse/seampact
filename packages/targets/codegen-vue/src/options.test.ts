import { clientTargetCompatibility } from "@seampact/spec/compatibility";
import { expect, test } from "vitest";
import { parseVueQueryOptions, QUERY_LIBRARIES } from "./options.js";

function refusalCodes(raw: unknown): string[] {
  const outcome = parseVueQueryOptions(raw);

  return outcome.status === "refused" ? outcome.refusals.map((refusal) => refusal.code) : [];
}

test("only `query` is required; every switch has its default", () => {
  expect(parseVueQueryOptions({ query: "tanstack" })).toEqual({
    status: "parsed",
    options: {
      query: "tanstack",
      errors: "throw",
      invalidate: "resource",
      staleTime: "off",
      infinite: "on",
    },
  });
});

test("every switch and `keys.root` are read, `staleTime: contract` included", () => {
  expect(
    parseVueQueryOptions({
      query: "tanstack",
      errors: "data",
      invalidate: "off",
      staleTime: "contract",
      infinite: "off",
      keys: { root: "tasksApi" },
    }),
  ).toEqual({
    status: "parsed",
    options: {
      query: "tanstack",
      errors: "data",
      invalidate: "off",
      staleTime: "contract",
      infinite: "off",
      keysRoot: "tasksApi",
    },
  });
});

test("a missing or unknown `query`, an unknown key and React's `useClientDirective` are refused by name", () => {
  expect(refusalCodes({})).toEqual(["options.query.missing"]);
  expect(refusalCodes({ query: "swr" })).toEqual(["options.query.invalid"]);
  expect(refusalCodes(null)).toEqual(["options.invalid"]);
  expect(
    refusalCodes({ query: "tanstack", useClientDirective: "off", errors: "log", keys: "tasks" }),
  ).toEqual(["options.unknown", "options.errors.invalid", "options.keys.invalid"]);
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
  expect(parseVueQueryOptions({ query: "fetch", errors: "data" })).toEqual({
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

test("the compatibility matrix selects a library for every `query` value but `fetch`", () => {
  const selectorValues = clientTargetCompatibility("@seampact/codegen-vue").libraries?.map(
    (library) => library.selectedBy?.value,
  );

  expect(new Set(selectorValues)).toEqual(
    new Set(QUERY_LIBRARIES.filter((library) => library !== "fetch")),
  );
});
