import { describe, expect, test } from "vitest";
import {
  deriveWireDerivedHeaders,
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireLocated,
  deriveWireOperation,
  deriveWireResponseHeaders,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("lifecycle"));

const STRING = { kind: "scalar", type: "string", refinements: {} };

const integer = (minimum: string, maximum?: string) => ({
  kind: "scalar",
  type: "integer",
  refinements: { minimum, ...(maximum === undefined ? {} : { maximum }) },
});

const LIST = (explode: boolean) => ({ kind: "list", style: "form", explode, brackets: false });

const NUMBER = { kind: "number", style: "form", explode: true, brackets: false };

const TEXT = { kind: "text", style: "form", explode: true, brackets: false };

const pagingQuery = (id: string) =>
  (deriveWireOperation(run, id).params?.query ?? [])
    .filter((param) => param.derivedFrom?.derivation === "paging.params")
    .map(({ name, type, required, wire }) => ({ name, type, required, wire }));

const optional = (name: string, type: object, wire: object) => ({
  name,
  type,
  required: false,
  wire,
});

describe("paging params", () => {
  test("a cursor style: the cursor, a limit bounded by maxLimit and a signed sort list", () => {
    expect(run.diagnostics).toEqual([]);
    expect(pagingQuery("plain")).toEqual([
      optional("cursor", STRING, TEXT),
      optional("limit", integer("1", "100"), NUMBER),
    ]);
    expect(deriveWireResponseHeaders(run, "plain")).toEqual({ 200: ["Link"] });
  });

  test("after and before (Stripe), with a clamped limit written without its maximum", () => {
    expect(pagingQuery("listDocs")).toEqual([
      optional("starting_after", STRING, TEXT),
      optional("ending_before", STRING, TEXT),
      optional("limit", integer("1"), NUMBER),
    ]);
  });

  test("page from its base (GitHub), a split sort, the total header and one Link", () => {
    expect(pagingQuery("listNotes")).toEqual([
      optional("page", integer("1"), NUMBER),
      optional("per_page", integer("1", "50"), NUMBER),
      optional("sort", STRING, TEXT),
      optional("direction", STRING, TEXT),
    ]);
    expect(deriveWireResponseHeaders(run, "listNotes")).toEqual({
      200: ["X-Total-Count", "Link"],
    });
  });

  test("page from base 0 with a repeated pair sort", () => {
    expect(pagingQuery("history")).toEqual([
      optional("page", integer("0"), NUMBER),
      optional("sort", { kind: "array", items: STRING }, LIST(true)),
    ]);
  });

  test("an offset, a limit sent as a header and a keyed sort, one parameter per key", () => {
    expect(pagingQuery("listDrafts")).toEqual([
      optional("offset", integer("0"), NUMBER),
      optional("order[revision]", STRING, TEXT),
      optional("order[text]", STRING, TEXT),
    ]);
    expect(deriveWireDerivedHeaders(run, "listDrafts").at(-1)).toEqual([
      "X-Limit",
      false,
      "paging.params",
    ]);
  });

  test("an instant since token is a date-time", () => {
    expect(pagingQuery("feed")[0]).toEqual(
      optional("since", { ...STRING, format: "date-time" }, TEXT),
    );
  });

  test("a signed sort is one comma-separated list, and no sort parameter without sortable", () => {
    const sorted = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [
        [
          "      plain:\n        method: get\n",
          "      plain:\n        method: get\n        sortable: [text]\n",
        ],
      ]),
    );

    expect(
      deriveWireOperation(sorted, "plain").params?.query.find((param) => param.name === "sort"),
    ).toMatchObject({ type: { kind: "array", items: STRING }, wire: LIST(false) });
    expect(pagingQuery("plain").map((param) => param.name)).not.toContain("sort");
  });

  test("a paging parameter taking a query credential's name is refused once at the style", () => {
    const clash = deriveWireRunContract(
      deriveWireFixtureVariant("lifecycle", [
        [
          "  deviceToken: { kind: header, name: X-Device-Token }\n",
          "  deviceToken: { kind: header, name: X-Device-Token }\n  mapsKey: { kind: query, name: cursor }\n",
        ],
        [
          "read: [bearer, sessionCookie, deviceToken]",
          "read: [bearer, sessionCookie, deviceToken, mapsKey]",
        ],
      ]),
    );

    expect(clash.diagnostics.map(deriveWireLocated)).toEqual([
      {
        rule: "seampact/derive/derived-name-collision",
        pointer: "/pagings/cursor",
        related: [
          "/surfaces/app/routes/plain",
          "/surfaces/app/identity",
          "/schemes/mapsKey",
          "/conventions/paging/default",
        ],
      },
    ]);
  });
});
