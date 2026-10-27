import { expect, test } from "vitest";
import { unlistedFrameworkRoutes } from "../../node-server-runtime/framework-route-patterns.js";

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
