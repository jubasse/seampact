import { describe, expect, test } from "vitest";
import {
  deriveWireDerivedHeaders,
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireLocated,
  deriveWireOperation,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("lifecycle"));

const cacheOf = (id: string) => deriveWireOperation(run, id).cache;

const SHARED_PUBLIC =
  "public, max-age=300, s-maxage=600, stale-while-revalidate=60, stale-if-error=3600, immutable, no-cache, must-revalidate";

describe("cache headers", () => {
  test("a family's directives are written in milliseconds, each one a Cache-Control directive", () => {
    expect(run.diagnostics).toEqual([]);
    expect(cacheOf("feed")).toMatchObject({
      family: "shared",
      directives: {
        maxAgeMs: 300000,
        sharedMaxAgeMs: 600000,
        staleWhileRevalidateMs: 60000,
        staleIfErrorMs: 3600000,
        immutable: true,
        noCache: true,
        mustRevalidate: true,
      },
      anonymous: "public",
      etag: false,
      noStore: false,
      perCallerKind: [{ caller: "anonymous", cacheControl: SHARED_PUBLIC }],
      origin: { layer: "api", pointer: "/surfaces/app/routes/feed/cache" },
      derivedFrom: {
        derivation: "cache.headers",
        from: [
          { layer: "api", pointer: "/surfaces/app/routes/feed/cache" },
          { layer: "api", pointer: "/conventions/cache/families/shared" },
        ],
      },
    });
  });

  test("an identified caller always gets private, without the shared-cache directives", () => {
    expect(cacheOf("board")?.perCallerKind).toEqual([
      { caller: "anonymous", cacheControl: SHARED_PUBLIC },
      {
        caller: "identified",
        cacheControl:
          "private, max-age=300, stale-while-revalidate=60, stale-if-error=3600, immutable, no-cache, must-revalidate",
      },
    ]);
    expect(cacheOf("getDoc")).toMatchObject({
      anonymous: "private",
      perCallerKind: [{ caller: "identified", cacheControl: "private, max-age=60" }],
    });
  });

  test("Vary lists the credential headers of the accepted schemes, then cache.vary", () => {
    expect(cacheOf("getDoc")?.vary).toEqual(["Authorization", "X-Device-Token", "Cookie"]);
    expect(cacheOf("feed")?.vary).toEqual(["Accept-Language"]);
  });

  test("etag adds the optional If-None-Match parameter and a 304 carrying the item's ETag", () => {
    const operation = deriveWireOperation(run, "getDoc");

    expect(deriveWireDerivedHeaders(run, "getDoc").at(-1)).toEqual([
      "If-None-Match",
      false,
      "cache.etag",
    ]);
    expect(operation.responses?.map((response) => response.status)).toEqual([200, 304]);
    expect(operation.responses?.[1]).toEqual({
      status: 304,
      shape: "empty",
      headers: [
        {
          name: "ETag",
          type: { kind: "scalar", type: "string", refinements: {} },
          required: true,
          derivedFrom: {
            derivation: "cache.etag",
            from: [{ layer: "api", pointer: "/surfaces/app/routes/docs/ops/get/cache" }],
          },
        },
      ],
      derivedFrom: {
        derivation: "cache.etag",
        from: [{ layer: "api", pointer: "/surfaces/app/routes/docs/ops/get/cache" }],
      },
    });
  });

  test("a cache inherited from a collection reaches its GET routes only, and a route without one has none", () => {
    const inherited = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [
        ["        item: Doc\n", "        item: Doc\n        cache: { freshness: minute }\n"],
        ["get: { cache: { freshness: minute, etag: true } }", "get: {}"],
      ]),
    );

    expect(inherited.diagnostics).toEqual([]);
    expect(deriveWireOperation(inherited, "getDoc").cache?.origin.pointer).toBe(
      "/surfaces/app/routes/docs/cache",
    );
    expect(deriveWireOperation(inherited, "updateDoc").cache).toBeUndefined();
    expect(cacheOf("plain")).toBeUndefined();
  });

  test("a family that is not declared or sets no maxAge is refused at the cache, naming the route", () => {
    const unknown = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [["freshness: minute", "freshness: hourly"]]),
    );
    const noMaxAge = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [["minute: 60s", "minute: { noCache: true }"]]),
    );

    for (const refused of [unknown, noMaxAge])
      expect(refused.diagnostics.map(deriveWireLocated)).toEqual([
        {
          rule: "seampact/derive/cache-family",
          pointer: "/surfaces/app/routes/docs/ops/get/cache",
          related: ["/surfaces/app/routes/docs/ops/get"],
        },
      ]);
  });

  test("a cache without freshness is refused at the cache", () => {
    const none = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [["freshness: minute, etag", "etag"]]),
    );

    expect(none.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/cache-freshness",
        pointer: "/surfaces/app/routes/docs/ops/get/cache",
        related: ["/surfaces/app/routes/docs/ops/get"],
      },
    ]);
  });

  test("a fault of a collection's cache is reported once, naming each GET route it reaches", () => {
    const refused = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [
        [
          "concurrency: { version: query.revision, field: revision }",
          "concurrency: { version: query.revision, field: revision }\n        cache: { freshness: hourly }",
        ],
      ]),
    );

    expect(refused.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/cache-family",
        pointer: "/surfaces/app/routes/notes/cache",
        related: ["/surfaces/app/routes/notes/ops/list", "/surfaces/app/routes/notes/ops/get"],
      },
    ]);
  });

  test("cache written on a non-GET route is refused", () => {
    const refused = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [
        [
          "update: { input: EditNote }",
          "update: { input: EditNote, cache: { freshness: minute } }",
        ],
      ]),
    );

    expect(refused.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/cache-method",
        pointer: "/surfaces/app/routes/notes/ops/update/cache",
        related: [],
      },
    ]);
  });
});

describe("sensitive responses are no-store", () => {
  test("a response carrying a sensitive field, on a read or a write without cache, is no-store at the field", () => {
    for (const id of ["keys", "rotateKey"])
      expect(cacheOf(id)).toEqual({
        family: "never",
        anonymous: "private",
        vary: [],
        etag: false,
        perCallerKind: [{ caller: "identified", cacheControl: "no-store" }],
        noStore: true,
        origin: { layer: "api", pointer: "/schemas/Key/properties/secret" },
        derivedFrom: {
          derivation: "cache.sensitive",
          from: [{ layer: "api", pointer: "/schemas/Key/properties/secret" }],
        },
      });
  });

  test("freshness: never over a sensitive field keeps its own cache, derived from the cache and the field", () => {
    expect(cacheOf("neverKeys")).toMatchObject({
      family: "never",
      noStore: true,
      perCallerKind: [{ caller: "identified", cacheControl: "no-store" }],
      derivedFrom: {
        derivation: "cache.sensitive",
        from: [
          { layer: "api", pointer: "/surfaces/app/routes/neverKeys/cache" },
          { layer: "api", pointer: "/schemas/Key/properties/secret" },
        ],
      },
    });
    expect(cacheOf("neverKeys")?.directives).toBeUndefined();
  });

  test("a cache family on a route answering a sensitive field is refused, naming the field and the route", () => {
    const refused = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [["freshness: never", "freshness: minute"]]),
    );

    expect(refused.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/cache-sensitive",
        pointer: "/surfaces/app/routes/neverKeys/cache",
        related: ["/surfaces/app/routes/neverKeys", "/schemas/Key/properties/secret"],
      },
    ]);
    expect(refused.diagnostics[0]?.message).toContain("'Key.secret'");
  });

  test("a collection's cache over a sensitive field is refused once, naming each route and the field", () => {
    const refused = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [
        [
          "concurrency: { version: query.revision, field: revision }",
          "concurrency: { version: query.revision, field: revision }\n        cache: { freshness: minute }",
        ],
        ["revision: { type: integer } }", "revision: { type: integer, sensitive: true } }"],
      ]),
    );

    expect(
      refused.diagnostics
        .map(deriveWireLocated)
        .filter((located) => located.pointer === "/surfaces/app/routes/notes/cache"),
    ).toEqual([
      {
        rule: "seampact/derive/cache-sensitive",
        pointer: "/surfaces/app/routes/notes/cache",
        related: [
          "/surfaces/app/routes/notes/ops/list",
          "/surfaces/app/routes/notes/ops/get",
          "/schemas/Note/properties/revision",
        ],
      },
    ]);
  });
});
