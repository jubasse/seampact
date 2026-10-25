import { describe, expect, test } from "vitest";
import type { PagingEntry } from "../../node-server-runtime/contract-route.js";
import { bothCursorsIssues } from "../../node-server-runtime/input-issues.js";

const PAIR_STYLE: Pick<PagingEntry, "positionParam" | "beforeParam"> = {
  positionParam: "starting_after",
  beforeParam: "ending_before",
};

// A style is read by its two cursor members only; the rest of the entry does not matter to the check.
function pairPaging(): PagingEntry {
  return {
    ...PAIR_STYLE,
    position: "cursor",
    base: 1,
    handlerResult: [],
    absent: "omit",
    body: { kind: "slot", slot: "items", path: [] },
    meta: [],
    headers: [],
    links: [],
  };
}

describe("a request sending both cursor parameters", () => {
  test("answers one issue at the before parameter, rule not", () => {
    expect(
      bothCursorsIssues(pairPaging(), { starting_after: "a", ending_before: "b" }),
    ).toEqual([{ in: "query", pointer: "/ending_before", rule: "not" }]);
  });

  test("is accepted with one of the two", () => {
    expect(bothCursorsIssues(pairPaging(), { starting_after: "a" })).toEqual([]);
    expect(bothCursorsIssues(pairPaging(), { ending_before: "b" })).toEqual([]);
  });
});
