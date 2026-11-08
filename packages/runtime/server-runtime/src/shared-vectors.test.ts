import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { type ListedRoute, unlistedFrameworkRoutes } from "./framework-route-patterns.js";
import { idempotencyDigest } from "./idempotency-fingerprint.js";
import { sha256Base64Url, sha256Hex } from "./sha256.js";

// The cross-language vectors of `fixtures/vectors/`, which the Spring Boot, PHP and Python runtimes read too.

interface DigestVectors {
  readonly canonical: readonly {
    readonly name: string;
    readonly parts: readonly unknown[];
    readonly text: string;
    readonly hex: string;
    readonly base64Url: string;
  }[];
  readonly bodies: readonly {
    readonly name: string;
    readonly body: string;
    readonly base64Url: string;
  }[];
}

interface RoutePatternVectors {
  readonly vectors: readonly {
    readonly name: string;
    readonly allowed: string;
    readonly route: string;
    readonly allows: boolean;
  }[];
}

function readVectors<Vectors>(file: string): Vectors {
  return JSON.parse(
    readFileSync(new URL(`../../../../fixtures/vectors/${file}`, import.meta.url), "utf8"),
  );
}

const digests = readVectors<DigestVectors>("digests.json");
const routePatterns = readVectors<RoutePatternVectors>("framework-route-patterns.json");

// The vectors write a param `{name}` and a catch-all `{*name}`; the Node routers write `:name` and `*name`.
function nodeRoutePath(route: string): string {
  return route.replaceAll(/\{\*(\w+)\}/g, "*$1").replaceAll(/\{(\w+)\}/g, ":$1");
}

describe.each(digests.canonical)("the digest vector '$name'", (vector) => {
  test("digests the parts to the vector's hex", async () => {
    expect(await idempotencyDigest(vector.parts)).toBe(vector.hex);
  });

  test("its text has the vector's digests", async () => {
    expect(await sha256Hex(vector.text)).toBe(vector.hex);
    expect(await sha256Base64Url(vector.text)).toBe(vector.base64Url);
  });
});

describe.each(digests.bodies)("the ETag vector '$name'", (vector) => {
  test("digests the body to the vector's base64url", async () => {
    expect(await sha256Base64Url(vector.body)).toBe(vector.base64Url);
  });
});

describe.each(routePatterns.vectors)("the route pattern vector '$name'", (vector) => {
  test("gives the vector's verdict", () => {
    const route: ListedRoute = { method: "GET", path: nodeRoutePath(vector.route) };
    const unlisted = unlistedFrameworkRoutes(
      {
        status: "on",
        allowed: [{ path: vector.allowed, reason: "a vector" }],
        scope: "strict",
      },
      [route],
    );

    expect(unlisted.length === 0).toBe(vector.allows);
  });
});
