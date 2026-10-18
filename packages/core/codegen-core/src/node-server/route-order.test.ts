import { describe, expect, test } from "vitest";
import { compareRouteSpecificity } from "./route-order.js";

describe("compareRouteSpecificity", () => {
  test("orders the member, collection and action trio static first, whatever the contract order", () => {
    const contractOrder = ["/things/{id}", "/things", "/things/search"];
    const orders = [
      contractOrder,
      [...contractOrder].reverse(),
      ["/things", "/things/{id}", "/things/search"],
    ];

    for (const order of orders) {
      expect([...order].sort(compareRouteSpecificity)).toEqual([
        "/things",
        "/things/search",
        "/things/{id}",
      ]);
    }
  });

  test("a static segment wins at the first segment where the paths differ in kind", () => {
    expect(compareRouteSpecificity("/a/{id}/b", "/a/b/{id}")).toBeGreaterThan(0);
    expect(compareRouteSpecificity("/a/b/{id}", "/a/{id}/b")).toBeLessThan(0);
  });

  test("paths of the same form compare equal, so a stable sort keeps the contract order", () => {
    expect(compareRouteSpecificity("/a/{x}", "/b/{y}")).toBe(0);
  });
});
