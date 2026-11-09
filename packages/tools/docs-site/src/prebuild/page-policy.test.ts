import { describe, expect, it } from "vitest";
import { isContributorPage, placementFrontmatter } from "./page-policy.ts";

describe("contributor pages", () => {
  it("count the maintainers folder", () => {
    expect(isContributorPage("maintainers/release.md")).toBe(true);
  });

  it("stay out of search and reading order", () => {
    expect(placementFrontmatter("maintainers/release.md")).toEqual({
      pagefind: false,
      prev: false,
      next: false,
    });
  });

  it("leave user pages alone", () => {
    expect(isContributorPage("backend/hono.md")).toBe(false);
  });
});
