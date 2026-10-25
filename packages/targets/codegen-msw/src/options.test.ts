import { expect, test } from "vitest";
import { parseMswMockOptions } from "./options.js";

test("no option parses to an empty set", () => {
  expect(parseMswMockOptions({})).toEqual({ status: "parsed", options: {} });
});

test("request validation is refused by name as not generated yet, any other key as unknown", () => {
  const outcome = parseMswMockOptions({ validateRequests: true, delay: 10 });

  expect(
    outcome.status === "refused" ? outcome.refusals.map(({ code, member }) => [code, member]) : [],
  ).toEqual([
    ["options.validateRequests.unsupported", "/validateRequests"],
    ["options.unknown", "/delay"],
  ]);
});

test("options that are not an object are refused", () => {
  const outcome = parseMswMockOptions([]);

  expect(outcome.status === "refused" ? outcome.refusals[0]?.code : undefined).toBe(
    "options.invalid",
  );
});
