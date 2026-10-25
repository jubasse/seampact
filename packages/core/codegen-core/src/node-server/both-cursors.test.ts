import { describe, expect, test } from "vitest";
import { repeatedBeforeParam } from "../../node-server-runtime/cursor-exclusion.js";

const PAIR = { positionParam: "starting_after", beforeParam: "ending_before" };

describe("a request sending both cursor parameters", () => {
  test("names the before parameter", () => {
    expect(repeatedBeforeParam(PAIR, { starting_after: "a", ending_before: "b" })).toBe(
      "ending_before",
    );
  });

  test("is accepted with one of the two", () => {
    expect(repeatedBeforeParam(PAIR, { starting_after: "a" })).toBeUndefined();
    expect(repeatedBeforeParam(PAIR, { ending_before: "b" })).toBeUndefined();
  });

  test("is accepted by a style with one cursor", () => {
    expect(repeatedBeforeParam({ positionParam: "cursor" }, { cursor: "a" })).toBeUndefined();
  });
});
