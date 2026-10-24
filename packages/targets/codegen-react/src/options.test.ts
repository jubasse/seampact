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

test("every query library the compatibility matrix selects by is a `query` value", () => {
  const selectorValues = clientTargetCompatibility("@seampact/codegen-react").libraries?.map(
    (library) => library.selectedBy?.value,
  );

  expect(selectorValues?.every((value) => QUERY_LIBRARIES.some((each) => each === value))).toBe(
    true,
  );
  expect(new Set(selectorValues)).toEqual(new Set(QUERY_LIBRARIES));
});
