import { expect, test } from "vitest";
import { unlistedFrameworkRoutes } from "../../node-server-runtime/framework-route-patterns.js";
import { routeEntries } from "../../node-server-runtime/node-express-routes.js";

const APP_ROUTES = [
  { method: "GET", path: "/health" },
  { method: "GET", path: "/api" },
  { method: "GET", path: "/api/v1/docs" },
  { method: "GET", path: "/:page/v1/x" },
  { method: "GET", path: "/:page" },
  { method: "ALL", path: "/*" },
];

test("the default scope checks only the app routes that can serve a path under a contract base path", () => {
  const contractScope = { status: "on", allowed: [], scope: { basePaths: ["/api/v1"] } } as const;

  expect(unlistedFrameworkRoutes(contractScope, APP_ROUTES)).toEqual([
    { method: "GET", path: "/api/v1/docs" },
    { method: "GET", path: "/:page/v1/x" },
    { method: "ALL", path: "/*" },
  ]);
});

test("the strict scope checks every app route", () => {
  const strictScope = { status: "on", allowed: [], scope: "strict" } as const;

  expect(unlistedFrameworkRoutes(strictScope, APP_ROUTES)).toEqual(APP_ROUTES);
});

test("an empty base path makes every app route overlap the contract", () => {
  const rootScope = { status: "on", allowed: [], scope: { basePaths: [""] } } as const;

  expect(unlistedFrameworkRoutes(rootScope, APP_ROUTES)).toEqual(APP_ROUTES);
});

const CONTRACT_SCOPE = { status: "on", allowed: [], scope: { basePaths: ["/api/v1"] } } as const;

test.each([
  ["a Hono param whose pattern takes a slash", "/:rest{.+}"],
  ["an Express 4 param whose pattern takes a slash", "/:rest(.+)"],
  ["an Express 4 param repeated over segments", "/:rest+"],
  ["a literal in another case, which Express matches", "/API/v1/tasks"],
  ["an Express 5 optional group, which can drop or add segments", "/api{/v1}"],
  ["a param pattern the check cannot read", "/:rest(?:a|.)"],
])("the default scope checks %s", (_, path) => {
  const route = { method: "GET", path };

  expect(unlistedFrameworkRoutes(CONTRACT_SCOPE, [route])).toEqual([route]);
});

test.each([
  ["a Hono param whose pattern keeps to one segment", "/:id{[0-9]+}"],
  ["an Express 4 param whose pattern keeps to one segment", "/:id(\\d+)"],
  ["two params in one segment", "/:from-:to"],
])("the default scope leaves %s alone when it cannot reach the base path", (_, path) => {
  expect(unlistedFrameworkRoutes(CONTRACT_SCOPE, [{ method: "GET", path }])).toEqual([]);
});

test("the default scope checks an Express route written as a regular expression", () => {
  const listed = routeEntries({ methods: { get: true }, path: /api/ });

  expect(unlistedFrameworkRoutes(CONTRACT_SCOPE, listed)).toEqual([
    { method: "GET", path: "/api/" },
  ]);
});
