import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { DraftIR } from "../../../pipeline/seam.js";
import {
  ACCESS_RIGHTS_FIXTURES,
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// The proofs fixture's members this half writes per operation: the derived header parameters and the input.
const proofMembersOf = (draft: DraftIR) =>
  Object.fromEntries(
    draft.operations.map((operation) => [
      operation.id,
      {
        headerProofs: operation.params?.header.filter((param) => param.derivedFrom !== undefined),
        ...(operation.input === undefined ? {} : { input: operation.input }),
      },
    ]),
  );

const fixtureRun = () => accessRightsRunContract(accessRightsLoadFixture("proofs"));

const expected = () =>
  JSON.parse(readFileSync(`${ACCESS_RIGHTS_FIXTURES}proofs/operations.json`, "utf8"));

const operationOf = (draft: DraftIR, id: string) => {
  const operation = draft.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the contract has no operation ${id}`);

  return operation;
};

const located = (diagnostics: readonly { rule: string; origin: { pointer: string } }[]) =>
  diagnostics.map(({ rule, origin }) => [rule.replace("seampact/access/", ""), origin.pointer]);

// A contract with a body proof rule, a header proof rule and a user identity; each test adds its routes.
const contract = (routes: string, topLevel = ""): string => `api: { name: vault, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  user: { schemes: { read: [bearer], write: [bearer] }, principal: UserPrincipal }
schemas:
  Token: { type: string }
  Note:
    type: object
    required: [noteId, token]
    properties: { noteId: Token, token: { type: string }, count: { type: integer }, flag: { type: boolean } }
  UserPrincipal: { type: object, required: [userId], properties: { userId: { type: string } } }
rules:
  recentAuth: { proof: { in: body, name: token, schema: Token } }
  numbered: { proof: { in: body, name: reauth, schema: { type: integer } } }
  worded: { proof: { in: body, name: reauth, schema: Token } }
  otp: { proof: { in: header, name: X-Otp, schema: Token } }
  otpAgain: { proof: { in: header, name: x-otp, schema: Token } }
  otpNumber: { proof: { in: header, name: X-OTP, schema: { type: integer } } }
${topLevel}surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes:
${routes}`;

const run = (routes: string, topLevel?: string, files: Record<string, string> = {}) =>
  accessRightsRunContract(
    accessRightsLoadFiles({ "api.yaml": contract(routes, topLevel), ...files }),
  );

describe("header proofs", () => {
  test("a header proof is a required derived header parameter, its derivedFrom the requirement then the proof", () => {
    const { draft, diagnostics } = fixtureRun();

    expect(diagnostics).toEqual([]);
    expect(proofMembersOf(draft).revealSecret?.headerProofs).toEqual(
      expected().revealSecret.headerProofs,
    );
  });

  test("two rules reading one header name, whatever its case, share a parameter; another schema is refused", () => {
    const shared = run(`      ping:
        method: post
        requires: [{ rule: otp }, { rule: otpAgain }]
        responses: { 204: {} }`);

    expect(shared.diagnostics).toEqual([]);
    expect(
      operationOf(shared.draft, "ping").params?.header.map((param) => ({
        name: param.name,
        from: param.derivedFrom?.from.map((origin) => origin.pointer),
      })),
    ).toEqual([
      {
        name: "X-Otp",
        from: [
          "/surfaces/app/routes/ping/requires/0",
          "/rules/otp/proof",
          "/surfaces/app/routes/ping/requires/1",
          "/rules/otpAgain/proof",
        ],
      },
    ]);

    const clash = run(`      ping:
        method: post
        requires: [{ rule: otp }, { rule: otpNumber }]
        responses: { 204: {} }`);

    expect(located(clash.diagnostics)).toEqual([
      ["proof-name", "/surfaces/app/routes/ping/requires/1"],
    ]);
    expect(clash.diagnostics[0]?.related.map((item) => item.origin.pointer)).toEqual([
      "/rules/otpNumber/proof",
      "/surfaces/app/routes/ping/requires/0",
      "/rules/otp/proof",
    ]);
  });
});

describe("body proofs", () => {
  test("proofs join a declared JSON, form or signed input in requirement order, shared by name, with a wire in a form", () => {
    const { draft, diagnostics } = fixtureRun();
    const members = proofMembersOf(draft);
    const fixture = expected();

    expect(diagnostics).toEqual([]);

    for (const id of ["updateSecret", "shareSecret", "events"])
      expect(members[id]?.input, id).toEqual(fixture[id].input);
  });

  test("a proof named as a field of the input, a non-object input and a body-less route are refused", () => {
    const { diagnostics } = run(`      notes:
        kind: collection
        id: { noteId: Token }
        item: Note
        ops:
          update: { input: Note, requires: [{ rule: recentAuth }] }
          delete: { requires: [{ rule: recentAuth }] }
        member:
          routes:
            peek: { method: get, requires: [{ rule: recentAuth }] }
            tag: { method: post, input: { type: array, items: Token }, requires: [{ rule: recentAuth }], responses: { 204: {} } }`);

    expect(located(diagnostics)).toEqual([
      ["proof-name", "/surfaces/app/routes/notes/ops/update/requires/0"],
      ["proof-input", "/surfaces/app/routes/notes/ops/delete/requires/0"],
      ["proof-input", "/surfaces/app/routes/notes/member/routes/peek/requires/0"],
      ["proof-input", "/surfaces/app/routes/notes/member/routes/tag/requires/0"],
    ]);
    expect(diagnostics[0]?.related.map((item) => item.origin.pointer)).toEqual([
      "/rules/recentAuth/proof",
      "/schemas/Note/properties/token",
    ]);
  });

  test("two body proofs of one name with different schemas are refused, naming both", () => {
    const { diagnostics } = run(`      ping:
        method: post
        requires: [{ rule: numbered }, { rule: worded }]
        responses: { 204: {} }`);

    expect(located(diagnostics)).toEqual([["proof-name", "/surfaces/app/routes/ping/requires/1"]]);
  });

  test("a file or opaque proof is refused at its schema", () => {
    const withFileProof = contract(`      ping: { method: post, responses: { 204: {} } }`).replace(
      "rules:\n",
      "rules:\n  upload: { proof: { in: body, name: scan, schema: { file: { media: [image/png], maxSize: 1MiB } } } }\n  blob: { proof: { in: header, name: X-Blob, schema: { opaque: Any value. } } }\n",
    );
    const { diagnostics } = accessRightsRunContract(
      accessRightsLoadFiles({ "api.yaml": withFileProof }),
    );

    expect(located(diagnostics)).toEqual([
      ["proof-schema", "/rules/upload/proof/schema"],
      ["proof-schema", "/rules/blob/proof/schema"],
    ]);
  });
});

describe("proof-only input", () => {
  test("a POST action without input gets a JSON input on ApiEmptyBody, its origin the first proof's requirement", () => {
    const { draft } = fixtureRun();

    expect(proofMembersOf(draft).revealSecret?.input).toEqual(expected().revealSecret.input);
  });

  test("a pack-derived proof gives the input the pack entry's origin", () => {
    const { draft, diagnostics } = run(
      `      ping: { method: post, responses: { 204: {} } }`,
      "packs: [./pack.yaml]\n",
      {
        "pack.yaml": `pack: { name: step-up, version: 1.0.0, extends: [] }
rules:
  stepUp: { proof: { in: body, name: stepUpToken, schema: { type: string } } }
derive:
  - entry: writes
    select: { access: [write] }
    require: { rule: stepUp }
`,
      },
    );

    expect(diagnostics).toEqual([]);
    const input = operationOf(draft, "ping").input;

    expect(input?.origin).toEqual({ layer: "pack:step-up", pointer: "/derive/0/require" });
    expect(input?.rawBody).toBe(false);
    expect(input?.proofs?.[0]?.derivedFrom.from[0]).toEqual(input?.origin);
  });
});

describe("signed proof-only input copies the identity policy", () => {
  test("(a) a signed route without input: rawBody true and the identity's unknownKeys with derivedFrom", () => {
    const { draft } = fixtureRun();

    expect(proofMembersOf(draft).ping?.input).toEqual(expected().ping.input);
    expect(operationOf(draft, "ping").input?.schema).toMatchObject({
      unknownKeys: { policy: "ignore", derivedFrom: { derivation: "identity.unknownKeys" } },
    });
  });

  test("(b) a signed route with a declared input: rawBody and unknownKeys stay access.identity's", () => {
    const { draft } = fixtureRun();
    const input = operationOf(draft, "events").input;

    expect(input?.rawBody).toBe(true);
    expect(input?.schema).toMatchObject({
      unknownKeys: { derivedFrom: { derivation: "identity.unknownKeys" } },
    });
    expect(input?.proofs?.map((proof) => proof.name)).toEqual(["reauthToken"]);
  });

  test("(c) a non-signed route with a declared input: no unknownKeys written", () => {
    const { draft } = fixtureRun();

    expect(operationOf(draft, "updateSecret").input?.schema).not.toHaveProperty("unknownKeys");
  });

  test("(d) a non-signed route without input: rawBody false and no unknownKeys", () => {
    const { draft } = fixtureRun();
    const input = operationOf(draft, "revealSecret").input;

    expect(input?.rawBody).toBe(false);
    expect(input?.schema).not.toHaveProperty("unknownKeys");
  });
});

describe("signed route without input", () => {
  test("(e) a signed identity's route left without input is refused, naming the route, the identity and the fix", () => {
    const { draft, diagnostics } = accessRightsRunContract(
      accessRightsLoadFiles({
        "api.yaml": `api: { name: hooks, version: 1 }
schemes:
  sig: { kind: signature, name: Sig, format: 'v1={sig}', algorithm: hmac-sha256, payload: '{rawBody}', encoding: hex, key: { value: hook } }
identities:
  hook: { kind: signed, scheme: sig, principal: Caller }
schemas:
  Caller: { type: object, required: [account], properties: { account: { type: string } } }
rules:
  recentAuth: { proof: { in: body, name: token, schema: { type: string } } }
surfaces:
  hooks:
    identity: hook
    routes:
      ping: { method: post, responses: { 204: {} } }
      pong: { method: post, requires: [{ rule: recentAuth }], responses: { 204: {} } }
`,
      }),
    );

    expect(
      diagnostics.map(({ rule, message, fix, origin }) => ({
        rule,
        message,
        fix,
        pointer: origin.pointer,
      })),
    ).toEqual([
      {
        rule: "seampact/access/signed-input",
        message:
          "route 'ping' runs under signed identity 'hook', whose signature covers the raw body, and has no input",
        fix: "declare `input`",
        pointer: "/surfaces/hooks/routes/ping",
      },
    ]);

    // A body proof gives the other route an input; its identity has no policy to copy.
    const pong = operationOf(draft, "pong").input;

    expect(pong?.rawBody).toBe(true);
    expect(pong?.schema).toEqual({ kind: "ref", schema: "ApiEmptyBody" });
  });
});
