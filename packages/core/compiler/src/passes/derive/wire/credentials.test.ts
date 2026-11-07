import { describe, expect, test } from "vitest";
import {
  deriveWireDerivedHeaders,
  deriveWireFixtureVariant,
  deriveWireLoadFixture,
  deriveWireOperation,
  deriveWireRunContract,
} from "./test-support.js";

const run = deriveWireRunContract(deriveWireLoadFixture("wire"));

const credentialParams = (id: string) =>
  deriveWireDerivedHeaders(run, id).filter(
    ([, , derivation]) => derivation === "identity.authenticate",
  );

describe("credential params", () => {
  test("a cookie is no parameter", () => {
    expect(run.diagnostics).toEqual([]);
    expect(credentialParams("notes")).toEqual([]);
    expect(credentialParams("board")).toEqual([]);
  });

  test("a single scheme of an identity access is required: header, bearer and signature schemes", () => {
    expect(credentialParams("ping")).toEqual([["X-Device-Token", true, "identity.authenticate"]]);
    expect(credentialParams("status")).toEqual([["Authorization", true, "identity.authenticate"]]);
    expect(credentialParams("stripe")).toEqual([
      ["Stripe-Signature", true, "identity.authenticate"],
    ]);
  });

  test("a query scheme is a query parameter with a text wire", () => {
    const query = deriveWireOperation(run, "tiles").params?.query ?? [];

    expect(query).toEqual([
      {
        name: "key",
        type: { kind: "scalar", type: "string", refinements: {} },
        required: true,
        wire: { kind: "text", style: "form", explode: true, brackets: false },
        derivedFrom: {
          derivation: "identity.authenticate",
          from: [
            { layer: "api", pointer: "/surfaces/partner/identity" },
            { layer: "api", pointer: "/schemes/mapsKey" },
          ],
        },
      },
    ]);
  });

  test("bearer and basic share one optional Authorization parameter carrying both schemes, in access order", () => {
    const header = deriveWireOperation(run, "jobs").params?.header ?? [];
    const authorization = header.filter((param) => param.name === "Authorization");

    expect(authorization).toHaveLength(1);
    expect(authorization[0]?.required).toBe(false);
    expect(authorization[0]?.derivedFrom?.from.map((origin) => origin.pointer)).toEqual([
      "/surfaces/robots/identity",
      "/schemes/basicAuth",
      "/schemes/bearer",
    ]);
  });

  test("two query schemes of one access on one parameter name share one parameter carrying both", () => {
    const shared = deriveWireRunContract(
      deriveWireFixtureVariant("wire", [
        [
          "  mapsKey: { kind: query, name: key }\n",
          "  mapsKey: { kind: query, name: key }\n  mapsKey2: { kind: query, name: key }\n",
        ],
        [
          "schemes: { read: [mapsKey], write: [] }",
          "schemes: { read: [mapsKey, mapsKey2], write: [] }",
        ],
      ]),
    );
    const query = deriveWireOperation(shared, "tiles").params?.query ?? [];

    expect(shared.diagnostics).toEqual([]);
    expect(query.map((param) => [param.name, param.required])).toEqual([["key", false]]);
    expect(query[0]?.derivedFrom?.from.map((origin) => origin.pointer)).toEqual([
      "/surfaces/partner/identity",
      "/schemes/mapsKey",
      "/schemes/mapsKey2",
    ]);
  });

  test("a public route has no credential parameter", () => {
    expect(credentialParams("github")).toEqual([]);
  });

  test("an optional access never requires its credential", () => {
    expect(deriveWireOperation(run, "feed").access?.kind).toBe("optional");
    expect(credentialParams("feed")).toEqual([["Authorization", false, "identity.authenticate"]]);
  });
});

const csrfParam = (id: string) =>
  deriveWireDerivedHeaders(run, id).filter(([, , derivation]) => derivation === "csrf.cookieWrite");

describe("csrf header param", () => {
  test("a cookie-only write requires the CSRF header", () => {
    expect(csrfParam("notes")).toEqual([["X-Csrf-Token", true, "csrf.cookieWrite"]]);
  });

  test("a write accepting a cookie and a bearer has the CSRF header, not required", () => {
    expect(csrfParam("comments")).toEqual([["X-Csrf-Token", false, "csrf.cookieWrite"]]);
  });

  test("an exempt write, a signed write and a safe route have none", () => {
    expect(deriveWireOperation(run, "comment").csrf).toMatchObject({ kind: "exempt" });
    expect(csrfParam("comment")).toEqual([]);
    expect(csrfParam("stripe")).toEqual([]);
    expect(csrfParam("board")).toEqual([]);
  });

  test("the parameter carries the derivation record access.identity wrote", () => {
    const operation = deriveWireOperation(run, "notes");
    const param = operation.params?.header.find((item) => item.name === "X-Csrf-Token");

    expect(operation.csrf?.kind).toBe("derived");
    expect(param?.derivedFrom).toEqual(
      operation.csrf?.kind === "derived" ? operation.csrf.derivedFrom : undefined,
    );
  });
});

describe("header tag", () => {
  test("a header-tagged union input derives its required tag header", () => {
    const param = deriveWireOperation(run, "github").params?.header.find(
      (item) => item.derivedFrom?.derivation === "union.headerTag",
    );

    expect(param).toEqual({
      name: "X-GitHub-Event",
      type: { kind: "scalar", type: "string", refinements: {} },
      required: true,
      derivedFrom: {
        derivation: "union.headerTag",
        from: [{ layer: "api", pointer: "/schemas/GithubEvent" }],
      },
    });
  });
});
