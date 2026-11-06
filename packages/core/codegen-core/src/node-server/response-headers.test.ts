import { expect, test } from "vitest";
import vectors from "../../../spec/vectors/ir/header-values.json" with { type: "json" };
import { deprecationValue, sunsetValue } from "./response-headers.js";

// The Deprecation and Sunset texts the route table writes, against the IR's shared header vectors, computed from
// the date's fields under any server zone.

const dateVectors = vectors.cases.filter(
  (vector) =>
    (vector.header === "deprecation" || vector.header === "sunset") && "expected" in vector,
);

test("the deprecation and sunset vectors are read", () => {
  expect(dateVectors.length).toBeGreaterThan(0);
});

test.each(dateVectors.map((vector) => [vector.id, vector] as const))("%s", (_, vector) => {
  const deprecated = vector.fragment.deprecated;
  const value =
    vector.header === "deprecation"
      ? deprecationValue(String(deprecated?.since))
      : sunsetValue(String(deprecated?.sunset));

  expect(value).toBe(vector.expected);
});

test.each([
  ["a year below 100", "0099-03-01", "@-59037897600", "Sun, 01 Mar 0099 00:00:00 GMT"],
  ["the first calendar day", "0001-01-01", "@-62135596800", "Mon, 01 Jan 0001 00:00:00 GMT"],
])("%s is written as dated, never as a 1900s year", (_, date, deprecation, sunset) => {
  expect(deprecationValue(date)).toBe(deprecation);
  expect(sunsetValue(date)).toBe(sunset);
});
