import { expect, test } from "vitest";
import { frameworkRouteProblems } from "../../node-server-runtime/framework-routes.js";

const CHECK_ON = { status: "on", allowed: [] } as const;

test("many unlisted framework routes are one problem naming each of them", () => {
  const problems = frameworkRouteProblems(CHECK_ON, [
    { method: "GET", path: "/" },
    { method: "POST", path: "/signup" },
    { method: "POST", path: "/login" },
  ]);

  expect(problems).toHaveLength(1);
  expect(problems[0]?.problem).toContain("3 framework routes");
  expect(problems[0]?.problem).toContain("'GET /'");
  expect(problems[0]?.problem).toContain("'POST /login'");
});

test("one unlisted framework route keeps its own wording", () => {
  const problems = frameworkRouteProblems(CHECK_ON, [{ method: "GET", path: "/docs" }]);

  expect(problems.map((problem) => problem.problem)).toEqual([
    "the framework route 'GET /docs' is outside the contract and not allow-listed",
  ]);
});
