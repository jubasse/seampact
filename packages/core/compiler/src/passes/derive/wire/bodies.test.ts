import { describe, expect, test } from "vitest";
import {
  deriveWireLoadFixture,
  deriveWireOperation,
  deriveWireResponseHeaders,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("lifecycle"));

const headersOf = (id: string, status: number) =>
  deriveWireOperation(run, id)
    .responses?.find((response) => response.status === status)
    ?.headers.map(({ name, type, required, derivedFrom }) => ({
      name,
      type,
      required,
      derivation: derivedFrom?.derivation,
    }));

const STRING = { kind: "scalar", type: "string", refinements: {} };

describe("download headers", () => {
  test("a file body answers the required Content-Type and the optional Content-Disposition", () => {
    expect(run.diagnostics).toEqual([]);
    expect(headersOf("export", 200)).toEqual([
      { name: "Content-Type", type: STRING, required: true, derivation: "response.download" },
      {
        name: "Content-Disposition",
        type: STRING,
        required: false,
        derivation: "response.download",
      },
    ]);
  });

  test("the shape stays tree.nodes'", () => {
    expect(deriveWireOperation(run, "export").responses?.[0]?.shape).toBe("binary");
    expect(deriveWireResponseHeaders(run, "plain")[200]).not.toContain("Content-Type");
  });
});

describe("redirect location", () => {
  test("a redirect answers the required Location, a uri-reference, beside a 200 without one", () => {
    const location = {
      name: "Location",
      type: { ...STRING, format: "uri-reference" },
      required: true,
      derivation: "redirect.location",
    };

    expect(headersOf("callback", 302)).toEqual([location]);
    expect(headersOf("moved", 303)).toEqual([location]);
    expect(headersOf("moved", 200)).toEqual([]);
    expect(deriveWireOperation(run, "callback").responses?.[0]?.shape).toBe("redirect");
  });
});
