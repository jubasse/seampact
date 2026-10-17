import { describe, expect, test } from "vitest";
import {
  accessIdentityCataloguesExpected,
  accessIdentityCataloguesRun,
  accessIdentityDraft,
  accessIdentityInline,
  accessIdentityRun,
  accessIdentityTableService,
} from "./test-support.js";

// Runs the half on an api file holding these schemes and no identity.
function compileSchemes(schemes: string) {
  const contract = accessIdentityInline(`api: { name: a, version: 1 }\nschemes:\n${schemes}`);

  return accessIdentityRun(contract, accessIdentityDraft(), accessIdentityTableService([]));
}

// The rules and messages of the diagnostics of `schemes`, and the ids of the schemes written.
function refusals(schemes: string) {
  const { draft, diagnostics } = compileSchemes(schemes);

  return {
    written: Object.keys(draft.schemes),
    diagnostics: diagnostics.map(({ rule, message, origin }) => ({
      rule,
      message,
      pointer: origin.pointer,
    })),
  };
}

const STRIPE = `
    kind: signature
    name: Stripe-Signature
    algorithm: hmac-sha256
    encoding: hex
    key: { value: stripe }`;

describe("security schemes", () => {
  test("each kind compiles to its tagged form", () => {
    const { draft, diagnostics } = accessIdentityCataloguesRun();

    expect(diagnostics).toEqual([]);
    expect({ ...draft.schemes }).toEqual(accessIdentityCataloguesExpected("schemes"));
  });

  test("a cookie, header, query or signature scheme needs its name", () => {
    expect(
      refusals(`
  session: { kind: cookie }
  apiKey: { kind: header }
  mapsKey: { kind: query }
  hook: { kind: signature, verify: application }
  bearer: { kind: bearer }
  basic: { kind: basic }`),
    ).toEqual({
      written: ["bearer", "basic"],
      diagnostics: [
        "cookie scheme 'session' has no 'name'",
        "header scheme 'apiKey' has no 'name'",
        "query scheme 'mapsKey' has no 'name'",
        "signature scheme 'hook' has no 'name'",
      ].map((message, index) => ({
        rule: "seampact/access/scheme-member",
        message,
        pointer: `/schemes/${["session", "apiKey", "mapsKey", "hook"][index]}`,
      })),
    });
  });

  test("a cookie or header name is an HTTP token, a query name unreserved characters", () => {
    expect(
      refusals(`
  session: { kind: cookie, name: "s;id" }
  apiKey: { kind: header, name: "X-Key\\r\\nSet-Cookie: a" }
  mapsKey: { kind: query, name: "api key" }
  plain: { kind: header, name: X-Api-Key }
  token: { kind: query, name: access_token }`),
    ).toEqual({
      written: ["plain", "token"],
      diagnostics: [
        {
          rule: "seampact/access/scheme-member",
          message: "cookie scheme 'session' has name \"s;id\", which is not an HTTP token",
          pointer: "/schemes/session/name",
        },
        {
          rule: "seampact/access/scheme-member",
          message:
            "header scheme 'apiKey' has name \"X-Key\\r\\nSet-Cookie: a\", which is not an HTTP token",
          pointer: "/schemes/apiKey/name",
        },
        {
          rule: "seampact/access/scheme-member",
          message:
            "query scheme 'mapsKey' has name \"api key\", which is not letters, digits and -._~",
          pointer: "/schemes/mapsKey/name",
        },
      ],
    });
  });

  test("a cookie's csrf names a declared header scheme", () => {
    expect(
      refusals(`
  session: { kind: cookie, name: s, csrf: missing }
  other: { kind: cookie, name: o, csrf: bearer }
  bearer: { kind: bearer }`).diagnostics,
    ).toEqual([
      {
        rule: "seampact/access/scheme-reference",
        message:
          "cookie scheme 'session' names 'missing' as its csrf scheme, which is no declared scheme",
        pointer: "/schemes/session/csrf",
      },
      {
        rule: "seampact/access/scheme-kind",
        message: "cookie scheme 'other' names 'bearer' as its csrf scheme, a bearer scheme",
        pointer: "/schemes/other/csrf",
      },
    ]);
  });

  test("a template signature declares its template members and its key, and no headers", () => {
    expect(
      refusals(`
  bare: { kind: signature, name: X-Sig }
  listed:${STRIPE}
    format: 'sha256={sig}'
    payload: '{rawBody}'
    headers: [X-Other]`).diagnostics,
    ).toEqual([
      {
        rule: "seampact/access/signature-verify",
        message:
          "signature scheme 'bare' verifies by template and has no 'format', 'algorithm', 'payload', 'encoding'",
        pointer: "/schemes/bare",
      },
      {
        rule: "seampact/access/signature-key",
        message: "signature scheme 'bare' verifies by template and has no 'key'",
        pointer: "/schemes/bare",
      },
      {
        rule: "seampact/access/signature-verify",
        message: "signature scheme 'listed' verifies by template and lists 'headers'",
        pointer: "/schemes/listed/headers",
      },
    ]);
  });

  test("an application signature takes headers and an optional key", () => {
    const { draft, diagnostics } = compileSchemes(`
  slack: { kind: signature, verify: application, name: X-Slack-Signature }
  keyed: { kind: signature, verify: application, name: X-Sig, key: { from: header.X-Key-Id } }`);

    expect(diagnostics).toEqual([]);
    expect({ ...draft.schemes }).toEqual({
      slack: {
        id: "slack",
        kind: "signature",
        name: "X-Slack-Signature",
        signature: { verify: "application", headers: [] },
        origin: { layer: "api", pointer: "/schemes/slack" },
      },
      keyed: {
        id: "keyed",
        kind: "signature",
        name: "X-Sig",
        signature: {
          verify: "application",
          headers: [],
          key: { kind: "from", from: { in: "header", name: "X-Key-Id" } },
        },
        origin: { layer: "api", pointer: "/schemes/keyed" },
      },
    });
  });

  test("a key names a value or a source", () => {
    expect(
      refusals(`
  empty:
    kind: signature
    name: X-Sig
    format: 'sha256={sig}'
    algorithm: hmac-sha256
    payload: '{rawBody}'
    encoding: hex
    key: {}`).diagnostics,
    ).toEqual([
      {
        rule: "seampact/access/signature-key",
        message: "the key of signature scheme 'empty' names neither a value nor a source",
        pointer: "/schemes/empty/key",
      },
    ]);
  });

  test.each([
    ["t={ts},v1={sig}", "{ts}.{rawBody}", true],
    ["sha256={sig}", "{rawBody}", true],
    ["{sig}", "{rawBody}", true],
    ["v1={sig},v1={sig}", "{rawBody}", false],
    ["{ts}{sig}", "{ts}.{rawBody}", false],
    ["sha256={sig},extra", "{rawBody}", false],
    ["t={ts},v1={sig},id={id}", "{ts}.{rawBody}", false],
    ["v1={ts},v1={sig}", "{ts}.{rawBody}", false],
    ["t={ts}, v1={sig}", "{ts}.{rawBody}", false],
    ["t ={ts},v1={sig}", "{ts}.{rawBody}", false],
  ])("the format '%s' with payload '%s' fits: %s", (format, payload, fits) => {
    const ts = format.includes("{ts}") ? "\n    tolerance: 5m" : "";
    const { diagnostics } = refusals(`
  sig:${STRIPE}
    format: '${format}'
    payload: '${payload}'${ts}`);

    expect(diagnostics.map(({ rule }) => rule)).toEqual(
      fits ? [] : ["seampact/access/signature-template"],
    );
  });

  test("a payload holds {rawBody} once, and {ts} exactly when the format reads it", () => {
    const payloadErrors = (format: string, payload: string, tolerance = "") =>
      refusals(`
  sig:${STRIPE}
    format: '${format}'
    payload: '${payload}'${tolerance}`).diagnostics.map(({ message }) => message);

    expect(payloadErrors("sha256={sig}", "{body}")).toEqual([
      "the payload '{body}' of signature scheme 'sig' must hold '{rawBody}' once and '{ts}' at most once, and no other placeholder",
    ]);
    expect(payloadErrors("sha256={sig}", "{ts}.{rawBody}", "\n    tolerance: 5m")).toEqual([
      "the payload of signature scheme 'sig' signs '{ts}', which its format does not read",
    ]);
    // A timestamp the MAC does not cover lets a replayed request pass with a fresh 't='.
    expect(payloadErrors("t={ts},v1={sig}", "{rawBody}", "\n    tolerance: 5m")).toEqual([
      "the format of signature scheme 'sig' reads '{ts}', which its payload does not sign",
    ]);
  });

  test("an unknown encoding is refused", () => {
    expect(
      refusals(`
  sig:
    kind: signature
    name: X-Sig
    format: 'sha256={sig}'
    algorithm: hmac-sha256
    payload: '{rawBody}'
    encoding: base32
    key: { value: k }`).diagnostics,
    ).toEqual([
      {
        rule: "seampact/access/signature-template",
        message: "signature scheme 'sig' has encoding 'base32', which is neither hex nor base64",
        pointer: "/schemes/sig/encoding",
      },
    ]);
  });

  test("an algorithm other than hmac-sha256 is refused", () => {
    expect(
      refusals(`
  none:
    kind: signature
    name: X-Sig
    format: 'sha256={sig}'
    algorithm: none
    payload: '{rawBody}'
    encoding: hex
    key: { value: k }
  sha1:
    kind: signature
    name: X-Sig
    format: 'sha1={sig}'
    algorithm: sha1
    payload: '{rawBody}'
    encoding: hex
    key: { value: k }`),
    ).toEqual({
      written: [],
      diagnostics: ["none", "sha1"].map((id) => ({
        rule: "seampact/access/signature-template",
        message: `signature scheme '${id}' has algorithm '${id}', which is not hmac-sha256`,
        pointer: `/schemes/${id}/algorithm`,
      })),
    });
  });

  test("a tolerance beyond the safe-integer range of milliseconds is refused", () => {
    expect(
      refusals(`
  sig:${STRIPE}
    format: 't={ts},v1={sig}'
    payload: '{ts}.{rawBody}'
    tolerance: 999999999999d`).diagnostics,
    ).toEqual([
      {
        rule: "seampact/access/signature-tolerance",
        message:
          "the tolerance '999999999999d' of signature scheme 'sig' is beyond 9007199254740991 milliseconds",
        pointer: "/schemes/sig/tolerance",
      },
    ]);
  });

  test("tolerance is required with {ts} and refused without", () => {
    expect(
      refusals(`
  timed:${STRIPE}
    format: 't={ts},v1={sig}'
    payload: '{ts}.{rawBody}'
  untimed:${STRIPE}
    format: 'sha256={sig}'
    payload: '{rawBody}'
    tolerance: 5m`).diagnostics,
    ).toEqual([
      {
        rule: "seampact/access/signature-tolerance",
        message: "signature scheme 'timed' reads '{ts}' and has no 'tolerance'",
        pointer: "/schemes/timed",
      },
      {
        rule: "seampact/access/signature-tolerance",
        message: "signature scheme 'untimed' has a 'tolerance' and reads no '{ts}'",
        pointer: "/schemes/untimed/tolerance",
      },
    ]);
  });
});
