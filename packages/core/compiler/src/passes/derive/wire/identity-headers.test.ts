import { describe, expect, test } from "vitest";
import {
  deriveWireDerivedHeaders,
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireOperation,
  deriveWireResponseHeaders,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("wire"));

const identityParams = (id: string) =>
  deriveWireDerivedHeaders(run, id).filter(
    ([, , derivation]) =>
      derivation?.startsWith("identity.") && derivation !== "identity.authenticate",
  );

describe("identity headers", () => {
  test("a deadline request header is a parameter and names deadlineHeader on reads and writes (for: all)", () => {
    expect(run.diagnostics).toEqual([]);
    expect(identityParams("status")).toEqual([["X-Deadline", true, "identity.header"]]);
    expect(deriveWireOperation(run, "status").deadlineHeader).toBe("X-Deadline");
    expect(deriveWireOperation(run, "jobs").deadlineHeader).toBe("X-Deadline");
  });

  test("a trace header for writes reaches writes only", () => {
    expect(identityParams("jobs")).toEqual([
      ["X-Deadline", true, "identity.header"],
      ["traceparent", false, "identity.header"],
    ]);
    expect(identityParams("status").map(([name]) => name)).not.toContain("traceparent");
  });

  test("a response-side header for reads goes on the success responses of reads only", () => {
    expect(deriveWireResponseHeaders(run, "board")).toEqual({
      200: ["traceresponse", "X-Rights-Version"],
    });
    expect(deriveWireResponseHeaders(run, "bigNotes")[200]).not.toContain("traceresponse");
  });

  test("a versionToken answers its response header on every success, its request header on writes only", () => {
    expect(identityParams("notes")).toEqual([
      ["If-Rights-Version", false, "identity.versionToken"],
    ]);
    expect(identityParams("board")).toEqual([]);
    expect(deriveWireResponseHeaders(run, "notes")[200]).toContain("X-Rights-Version");

    const header = deriveWireOperation(run, "board").responses?.[0]?.headers.find(
      (item) => item.name === "X-Rights-Version",
    );

    expect(header).toEqual({
      name: "X-Rights-Version",
      type: { kind: "scalar", type: "string", refinements: {} },
      required: true,
      semantic: "versionToken",
      derivedFrom: {
        derivation: "identity.versionToken",
        from: [
          { layer: "api", pointer: "/identities/member/headers/rightsVersion" },
          { layer: "api", pointer: "/headers/rightsVersion" },
        ],
      },
    });
  });

  test("a versionToken request header stays on writes even with for: reads", () => {
    const forReads = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [
        ["{ from: principal.rightsVersion,", "{ for: reads, from: principal.rightsVersion,"],
      ]),
    );
    const params = (id: string) =>
      deriveWireDerivedHeaders(forReads, id).filter(
        ([, , derivation]) => derivation === "identity.versionToken",
      );

    expect(forReads.diagnostics).toEqual([]);
    expect(params("notes")).toEqual([["If-Rights-Version", false, "identity.versionToken"]]);
    expect(params("board")).toEqual([]);
  });

  test("a required versionToken use makes its request header required", () => {
    const required = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [
        ["{ from: principal.rightsVersion,", "{ required: true, from: principal.rightsVersion,"],
      ]),
    );

    expect(
      deriveWireDerivedHeaders(required, "notes").find(([name]) => name === "If-Rights-Version"),
    ).toEqual(["If-Rights-Version", true, "identity.versionToken"]);
  });

  test("two response declarations of one identity on one wire name with one shape merge into one header", () => {
    const merged = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [
        [
          "  served: { name: traceresponse, in: response, semantic: traceContext }\n",
          "  served: { name: traceresponse, in: response, semantic: traceContext }\n  echoed: { name: TraceResponse, in: response, semantic: traceContext }\n",
        ],
        [
          "      served: { for: reads }\n",
          "      served: { for: reads }\n      echoed: { for: reads }\n",
        ],
      ]),
    );
    const headers = deriveWireOperation(merged, "board").responses?.[0]?.headers ?? [];

    expect(merged.diagnostics).toEqual([]);
    expect(headers.filter((header) => header.name.toLowerCase() === "traceresponse")).toEqual([
      expect.objectContaining({
        name: "traceresponse",
        derivedFrom: {
          derivation: "identity.header",
          from: [
            { layer: "api", pointer: "/identities/member/headers/served" },
            { layer: "api", pointer: "/headers/served" },
            { layer: "api", pointer: "/identities/member/headers/echoed" },
            { layer: "api", pointer: "/headers/echoed" },
          ],
        },
      }),
    ]);
  });

  test("a route without an identity gets no identity header", () => {
    expect(identityParams("github")).toEqual([]);
    expect(deriveWireOperation(run, "github").deadlineHeader).toBeUndefined();
  });
});

describe("optional access", () => {
  const optional = deriveWireRunContract(
    deriveWireFixtureVariant("wire", [
      [
        "      notes:\n        input: Note\n",
        '      notes:\n        access: { optionalAuth: "Guests leave notes too." }\n        input: Note\n',
      ],
    ]),
  );
  const derivedOf = (id: string, name: string) =>
    deriveWireDerivedHeaders(optional, id).find(([header]) => header === name);
  const responseHeaderOf = (id: string, name: string) =>
    deriveWireOperation(optional, id)
      .responses?.find((response) => response.status === 200)
      ?.headers.find((header) => header.name === name);

  test("a cookie write on optional access has an optional CSRF header and versionToken request header", () => {
    expect(optional.diagnostics).toEqual([]);
    expect(derivedOf("notes", "X-Csrf-Token")).toEqual(["X-Csrf-Token", false, "csrf.cookieWrite"]);
    expect(derivedOf("notes", "If-Rights-Version")).toEqual([
      "If-Rights-Version",
      false,
      "identity.versionToken",
    ]);
  });

  test("the versionToken response header is optional on optional access, required on identity access", () => {
    expect(responseHeaderOf("notes", "X-Rights-Version")?.required).toBe(false);
    expect(responseHeaderOf("board", "X-Rights-Version")?.required).toBe(true);
  });

  test("a required identity response header is optional on optional access", () => {
    const answered = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [
        [
          "      trace: { for: writes }\n",
          "      trace: { for: writes }\n      served: { for: reads, required: true }\n",
        ],
      ]),
    );
    const servedOf = (id: string) =>
      deriveWireOperation(answered, id).responses?.[0]?.headers.find(
        (header) => header.name === "traceresponse",
      )?.required;

    expect(answered.diagnostics).toEqual([]);
    expect(servedOf("feed")).toBe(false);
    expect(servedOf("status")).toBe(true);
  });

  test("a required identity request header is optional on optional access, the identity keeping its use", () => {
    expect(derivedOf("feed", "X-Deadline")).toEqual(["X-Deadline", false, "identity.header"]);
    expect(derivedOf("status", "X-Deadline")).toEqual(["X-Deadline", true, "identity.header"]);
    expect(optional.draft.identities.robot?.headers).toContainEqual(
      expect.objectContaining({ header: "deadline", required: true }),
    );
  });
});
