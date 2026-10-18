import { describe, expect, test } from "vitest";
import {
  deriveWireLoadFixture,
  deriveWireOperation,
  deriveWireResponseHeaders,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("lifecycle"));

const concurrencyParams = (id: string, place: "query" | "header") =>
  (deriveWireOperation(run, id).params?.[place] ?? [])
    .filter((param) => param.derivedFrom?.derivation === "concurrency.version")
    .map(({ name, type, required }) => ({ name, type, required }));

const INTEGER = { kind: "scalar", type: "integer", refinements: {} };

const STRING = { kind: "scalar", type: "string", refinements: {} };

describe("version param", () => {
  test("a query version is a required query parameter typed like field, on update and delete", () => {
    expect(run.diagnostics).toEqual([]);

    for (const id of ["updateNote", "deleteNote"]) {
      expect(concurrencyParams(id, "query")).toEqual([
        { name: "revision", type: INTEGER, required: true },
      ]);
      expect(
        deriveWireOperation(run, id).params?.query.find((param) => param.name === "revision")?.wire,
      ).toEqual({ kind: "number", style: "form", explode: true, brackets: false });
    }
  });

  test("a body version is the input's property, read from the query on a DELETE without input", () => {
    expect(concurrencyParams("updateDraft", "query")).toEqual([]);
    expect(concurrencyParams("deleteDraft", "query")).toEqual([
      { name: "expectedRevision", type: INTEGER, required: true },
    ]);
  });

  test("concurrency.derivedFrom names the resource's concurrency, then a member route's inherit", () => {
    expect(deriveWireOperation(run, "updateDraft").concurrency?.derivedFrom).toEqual({
      derivation: "concurrency.version",
      from: [{ layer: "api", pointer: "/surfaces/app/routes/drafts/concurrency" }],
    });
    expect(deriveWireOperation(run, "publishDraft").concurrency?.derivedFrom?.from).toEqual([
      { layer: "api", pointer: "/surfaces/app/routes/drafts/concurrency" },
      {
        layer: "api",
        pointer: "/surfaces/app/routes/drafts/member/routes/publish/concurrency",
      },
    ]);
    expect(deriveWireOperation(run, "getNote").concurrency).toBeUndefined();
  });
});

describe("if-match and etag", () => {
  test("an If-Match version is a required string header, and the item's success responses carry the ETag", () => {
    expect(concurrencyParams("updateDoc", "header")).toEqual([
      { name: "If-Match", type: STRING, required: true },
    ]);
    expect(deriveWireResponseHeaders(run, "updateDoc")).toEqual({ 200: ["ETag"] });
  });

  test("a read of the resource carrying the item writes the ETag too, a page does not", () => {
    expect(deriveWireResponseHeaders(run, "listDocs")).toEqual({ 200: [] });
    expect(
      deriveWireOperation(run, "getDoc").responses?.[0]?.headers.find(
        (header) => header.name === "ETag",
      )?.derivedFrom?.derivation,
    ).toBe("concurrency.version");
  });
});
