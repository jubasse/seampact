import { describe, expect, test } from "vitest";
import {
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// A throttle rule and buckets keyed by the principal, body fields and a body proof; each test adds its routes.
const contract = (routes: string): string => `api: { name: mail, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  user: { schemes: { read: [bearer], write: [bearer] }, principal: UserPrincipal }
enums:
  Kind: { values: [plain, digest], reason: The two mail kinds. }
schemas:
  Message:
    type: object
    required: [to, count, urgent, kind, replyTo, secret]
    properties:
      to: { type: string }
      count: { type: integer }
      urgent: { type: boolean }
      kind: { enum: Kind }
      cc: { type: string }
      replyTo: { type: string, nullable: true }
      secret: { type: string, sensitive: true }
  UserPrincipal: { type: object, required: [userId], properties: { userId: { type: string } } }
rules:
  throttle: { bucket: true }
  recentAuth: { proof: { in: body, name: reauthToken, schema: { type: string } } }
buckets:
  perUser: { key: [principal.userId] }
  perRecipient: { key: [body.to, address] }
  perCount: { key: [body.count] }
  perUrgency: { key: [body.urgent] }
  perKind: { key: [body.kind] }
  perCc: { key: [body.cc] }
  perReplyTo: { key: [body.replyTo] }
  perSecret: { key: [body.secret] }
  perSubject: { key: [body.subject] }
  perToken: { key: [body.reauthToken] }
surfaces:
  app:
    prefix: /v{version}
    identity: user
    routes:
${routes}`;

const located = (diagnostics: readonly { rule: string; origin: { pointer: string } }[]) =>
  diagnostics.map(({ rule, origin }) => [rule.replace("seampact/access/", ""), origin.pointer]);

const run = (routes: string) =>
  accessRightsRunContract(accessRightsLoadFiles({ "api.yaml": contract(routes) }));

describe("buckets and throttle", () => {
  test("a form field and a principal field key a throttle on the proofs fixture", () => {
    expect(accessRightsRunContract(accessRightsLoadFixture("proofs")).diagnostics).toEqual([]);
  });

  test("body keys name a required, non-null string or integer field of the input", () => {
    const { diagnostics } = run(`      send:
        method: post
        input: Message
        requires:
          - { rule: throttle, bucket: perRecipient }
          - { rule: throttle, bucket: perCount }
        responses: { 204: {} }`);

    expect(diagnostics).toEqual([]);
  });

  test("an optional, nullable or sensitive field and a body proof are refused as keys", () => {
    const { diagnostics } = run(`      send:
        method: post
        input: Message
        requires:
          - { rule: recentAuth }
          - { rule: throttle, bucket: perCc }
          - { rule: throttle, bucket: perReplyTo }
          - { rule: throttle, bucket: perSecret }
          - { rule: throttle, bucket: perToken }
        responses: { 204: {} }
      ping:
        method: post
        requires: [{ rule: recentAuth }, { rule: throttle, bucket: perToken }]
        responses: { 204: {} }`);

    expect(located(diagnostics)).toEqual([
      ["bucket-key", "/surfaces/app/routes/send/requires/1"],
      ["bucket-key", "/surfaces/app/routes/send/requires/2"],
      ["bucket-key", "/surfaces/app/routes/send/requires/3"],
      ["bucket-key", "/surfaces/app/routes/send/requires/4"],
      ["bucket-key", "/surfaces/app/routes/ping/requires/1"],
    ]);
    expect(diagnostics.map(({ message, fix }) => [message, fix])).toEqual([
      [
        "bucket 'perCc' counts body.cc on route 'send', whose input field 'cc' may be absent or null",
        "make the field required and non-null, or count another source",
      ],
      [
        "bucket 'perReplyTo' counts body.replyTo on route 'send', whose input field 'replyTo' may be absent or null",
        "make the field required and non-null, or count another source",
      ],
      [
        "bucket 'perSecret' counts body.secret on route 'send', whose input field 'secret' is sensitive",
        "count a field that is not sensitive, or another source",
      ],
      [
        "bucket 'perToken' counts body.reauthToken on route 'send', whose body field 'reauthToken' is a rule proof, which is sensitive",
        "count an input field that is not sensitive, or another source",
      ],
      [
        "bucket 'perToken' counts body.reauthToken on route 'ping', whose body field 'reauthToken' is a rule proof, which is sensitive",
        "count an input field that is not sensitive, or another source",
      ],
    ]);
  });

  test("a key naming a body proof the route refuses is reported once, as the proof's error", () => {
    const { diagnostics } = run(`      peek:
        method: get
        requires: [{ rule: recentAuth }, { rule: throttle, bucket: perToken }]`);

    expect(located(diagnostics)).toEqual([["proof-input", "/surfaces/app/routes/peek/requires/0"]]);
  });

  test("a missing body field, a boolean or enum field and a principal key on a public route are refused", () => {
    const { diagnostics } = run(`      send:
        method: post
        input: Message
        requires:
          - { rule: throttle, bucket: perUrgency }
          - { rule: throttle, bucket: perSubject }
          - { rule: throttle, bucket: perKind }
        responses: { 204: {} }
      status:
        method: get
        access: { public: Anyone may read the status. }
        requires: [{ rule: throttle, bucket: perUser }]
      inbox:
        method: get
        access: { optionalAuth: A signed-in reader also sees their own mail. }
        requires: [{ rule: throttle, bucket: perUser }]
      ping:
        method: post
        requires: [{ rule: throttle, bucket: perRecipient }]
        responses: { 204: {} }`);

    expect(located(diagnostics)).toEqual([
      ["bucket-key", "/surfaces/app/routes/send/requires/0"],
      ["bucket-key", "/surfaces/app/routes/send/requires/1"],
      ["bucket-key", "/surfaces/app/routes/send/requires/2"],
      ["bucket-key", "/surfaces/app/routes/status/requires/0"],
      ["bucket-key", "/surfaces/app/routes/inbox/requires/0"],
      ["bucket-key", "/surfaces/app/routes/ping/requires/0"],
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "bucket 'perUrgency' counts body.urgent on route 'send', whose input field 'urgent' is no string or integer",
      "bucket 'perSubject' counts body.subject on route 'send', whose input has no field 'subject'",
      "bucket 'perKind' counts body.kind on route 'send', whose input field 'kind' is no string or integer",
      "bucket 'perUser' counts principal.userId on route 'status', a public route, where the principal may be null",
      "bucket 'perUser' counts principal.userId on route 'inbox', an optional-auth route, where the principal may be null",
      "bucket 'perRecipient' counts body.to on route 'ping', whose input has no field 'to'",
    ]);
    expect(diagnostics[0]?.related.map((item) => item.origin.pointer)).toEqual([
      "/buckets/perUrgency/key/0",
    ]);
  });
});
