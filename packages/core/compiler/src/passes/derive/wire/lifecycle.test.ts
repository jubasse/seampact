import { describe, expect, test } from "vitest";
import {
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireOperation,
  deriveWireResponseHeaders,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("lifecycle"));

describe("deprecation headers", () => {
  test("the renamed deprecation and sunset headers, and the successor Link, on every success", () => {
    expect(run.diagnostics).toEqual([]);
    expect(deriveWireResponseHeaders(run, "legacy")).toEqual({
      200: ["X-Deprecated", "X-Sunset", "Link"],
    });
    expect(deriveWireOperation(run, "legacy").responses?.[0]?.headers[0]).toEqual({
      name: "X-Deprecated",
      type: { kind: "scalar", type: "string", refinements: {} },
      required: true,
      derivedFrom: {
        derivation: "deprecation.headers",
        from: [
          { layer: "api", pointer: "/surfaces/app/routes/legacy/deprecated" },
          { layer: "api", pointer: "/conventions/deprecation/header" },
          { layer: "api", pointer: "/conventions/deprecation/sunsetHeader" },
        ],
      },
    });
  });

  test("no successor, no Link; a route that is not deprecated has none", () => {
    expect(deriveWireResponseHeaders(run, "retired")).toEqual({
      200: ["X-Deprecated", "X-Sunset"],
    });
    expect(deriveWireResponseHeaders(run, "plain")[200]).not.toContain("X-Deprecated");
  });

  test("a successor that names no operation of the api is refused before derive.wire runs", () => {
    expect(() =>
      deriveWireRunContract(
        deriveWireFixtureVariant("lifecycle", [["successor: board", "successor: nowhere"]]),
      ),
    ).toThrow(/seampact\/tree\/deprecated-successor/);
  });
});

describe("derived maturity", () => {
  test("the owning service's maturity, the first of upstream", () => {
    expect(deriveWireOperation(run, "prices").maturity).toEqual({
      level: "experimental",
      source: "upstream",
      origin: { layer: "api", pointer: "/services/billing" },
    });
  });

  test("the api's maturity without upstream, located at the api's maturity", () => {
    expect(deriveWireOperation(run, "plain").maturity).toEqual({
      level: "provisional",
      source: "api",
      origin: { layer: "api", pointer: "/api/maturity" },
    });
  });

  test("a stated maturity is kept, with its reason", () => {
    expect(deriveWireOperation(run, "beta").maturity).toMatchObject({
      level: "experimental",
      source: "stated",
      reason: "The board layout may change.",
    });
  });
});
