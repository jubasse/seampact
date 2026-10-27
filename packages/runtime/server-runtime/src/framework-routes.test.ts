import { expect, test } from "vitest";
import { unlistedFrameworkRoutesProblem } from "./framework-route-patterns.js";

const CHECK_ON = { status: "on", allowed: [], scope: "strict" } as const;

test("many unlisted framework routes are one problem naming each of them", () => {
  const problem = unlistedFrameworkRoutesProblem(CHECK_ON, [
    { method: "GET", path: "/" },
    { method: "POST", path: "/signup" },
    { method: "POST", path: "/login" },
  ]);

  expect(problem?.problem).toContain("3 framework routes");
  expect(problem?.problem).toContain("'GET /'");
  expect(problem?.problem).toContain("'POST /login'");
});

test("one unlisted framework route keeps its own wording", () => {
  const problem = unlistedFrameworkRoutesProblem(CHECK_ON, [{ method: "GET", path: "/docs" }]);

  expect(problem?.problem).toBe(
    "the framework route 'GET /docs' is outside the contract and not allow-listed",
  );
});

test("the fix tells to run generate again after editing frameworkRoutes", () => {
  const problem = unlistedFrameworkRoutesProblem(CHECK_ON, [{ method: "GET", path: "/docs" }]);

  expect(problem?.fix).toContain("run seampact generate again");
});
