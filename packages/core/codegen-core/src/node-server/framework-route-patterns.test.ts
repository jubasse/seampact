import { describe, expect, test } from "vitest";
import {
  type FrameworkRouteAllowance,
  type FrameworkRouteCheck,
  type ListedRoute,
  unlistedFrameworkRoutes,
} from "../../node-server-runtime/framework-route-patterns.js";

function checkAllowing(...allowed: FrameworkRouteAllowance[]): FrameworkRouteCheck {
  return { status: "on", allowed };
}

function refusedKeys(check: FrameworkRouteCheck, listed: readonly ListedRoute[]): string[] {
  return unlistedFrameworkRoutes(check, listed).map((route) => `${route.method} ${route.path}`);
}

const REASON = "a test allowance";

describe("the allow-list patterns", () => {
  test.each([
    ["a literal path", "/metrics", "/metrics", true],
    ["another literal path", "/metrics", "/health", false],
    ["'*' over one segment", "/admin/*", "/admin/queues", true],
    ["'*' over a param", "/orders/*", "/orders/:id", true],
    ["'*' over two segments", "/admin/*", "/admin/queues/jobs", false],
    ["'**' over zero segments", "/actuator/**", "/actuator", true],
    ["'**' over several segments", "/actuator/**", "/actuator/health/db", true],
    ["'**' inside a segment", "/actuator/**", "/actuatorX", false],
    ["'**' between segments", "/a/**/z", "/a/z", true],
    ["'*' inside a segment", "/livewire-*/**", "/livewire-3f9a/upload-file", true],
    ["'*' inside a segment over nothing", "/livewire*/**", "/livewire/update", true],
    ["'*' inside a segment over a param", "/files-*", "/files-:id", true],
    ["'*' inside a segment, another prefix", "/livewire-*/**", "/live-3f9a/upload-file", false],
    ["'*' inside a segment over a slash", "/livewire-*", "/livewire-3f9a/upload-file", false],
    ["'*' inside a segment, a suffix", "/*.json", "/up.json", true],
    ["'*' inside a segment, another suffix", "/*.json", "/up.xml", false],
    ["two '**' around literals", "/a/**/b/**/c", "/a/x/b/y/z/c", true],
    ["two '**' over nothing", "/a/**/b/**/c", "/a/b/c", true],
    ["two '**', literals out of order", "/a/**/b/**/c", "/a/c/b", false],
    ["'**' then '*'", "/**/*", "/", false],
    ["'**' beside '**'", "/**/**", "/x", true],
    ["a trailing slash, as its path without it", "/a", "/a/", true],
    ["'**' over a trailing slash", "/a/**", "/a/", true],
    ["'*' over a trailing slash", "/a/*", "/a/", false],
    ["a doubled slash, as one", "/a/b", "/a//b", true],
    ["'*' over a doubled slash", "/a/*/b", "/a//b", false],
    ["the root", "/", "/", true],
    ["'**' over the root", "/**", "/", true],
    ["'*' over the root", "/*", "/", false],
  ])("%s", (_, allowedPath, listedPath, allowed) => {
    const keys = refusedKeys(checkAllowing({ path: allowedPath, reason: REASON }), [
      { method: "GET", path: listedPath },
    ]);

    expect(keys).toEqual(allowed ? [] : [`GET ${listedPath}`]);
  });

  test.each([
    ["a bare star", "/files/*"],
    ["a named splat", "/files/*rest"],
    ["a param with a star", "/files/:path*"],
    ["a regular expression", "/.*/"],
  ])("a catch-all written as %s matches '**' only", (_, listedPath) => {
    const listed = [{ method: "GET", path: listedPath }];

    expect(refusedKeys(checkAllowing({ path: "/files/*", reason: REASON }), listed)).toEqual([
      `GET ${listedPath}`,
    ]);
    expect(refusedKeys(checkAllowing({ path: "/*", reason: REASON }), listed)).toEqual([
      `GET ${listedPath}`,
    ]);
    expect(refusedKeys(checkAllowing({ path: "/files/*rest", reason: REASON }), listed)).toEqual([
      `GET ${listedPath}`,
    ]);
    expect(refusedKeys(checkAllowing({ path: "/**", reason: REASON }), listed)).toEqual([]);
  });
});

describe("the allow-list cost", () => {
  // Backtracking over every split of the path took seconds on this case.
  const BOUND_MILLISECONDS = 1_000;

  test("many '**' against a long path that does not match finish fast", () => {
    const pattern = `${"/**/x".repeat(8)}/end`;
    const longPath = `/${Array.from({ length: 30 }, () => "x").join("/")}/other`;
    const started = performance.now();

    const keys = refusedKeys(checkAllowing({ path: pattern, reason: REASON }), [
      { method: "GET", path: longPath },
    ]);

    expect(keys).toEqual([`GET ${longPath}`]);
    expect(performance.now() - started).toBeLessThan(BOUND_MILLISECONDS);
  });
});

describe("the allow-list methods", () => {
  test("a method-scoped allowance refuses the other methods", () => {
    const check = checkAllowing({ method: "GET", path: "/metrics", reason: REASON });

    expect(
      refusedKeys(check, [
        { method: "GET", path: "/metrics" },
        { method: "POST", path: "/metrics" },
        { method: "ALL", path: "/metrics" },
      ]),
    ).toEqual(["POST /metrics", "ALL /metrics"]);
  });

  test("HEAD follows an allowed GET", () => {
    const check = checkAllowing({ method: "GET", path: "/metrics", reason: REASON });

    expect(refusedKeys(check, [{ method: "HEAD", path: "/metrics" }])).toEqual([]);
  });

  test("an allowance without a method allows every method", () => {
    const check = checkAllowing({ path: "/metrics", reason: REASON });

    expect(
      refusedKeys(check, [
        { method: "POST", path: "/metrics" },
        { method: "ALL", path: "/metrics" },
      ]),
    ).toEqual([]);
  });
});

describe("the unlisted routes", () => {
  test("each route once, without its HEAD or a repeat", () => {
    const listed = [
      { method: "GET", path: "/own" },
      { method: "HEAD", path: "/own" },
      { method: "GET", path: "/own" },
    ];

    expect(refusedKeys(checkAllowing(), listed)).toEqual(["GET /own"]);
  });

  test("a route at a contract's path is refused like any other listed route", () => {
    expect(refusedKeys(checkAllowing(), [{ method: "GET", path: "/orders/:id" }])).toEqual([
      "GET /orders/:id",
    ]);
  });

  test("none when the check is off", () => {
    expect(refusedKeys({ status: "off" }, [{ method: "GET", path: "/own" }])).toEqual([]);
  });
});
