import { describe, expect, test } from "vitest";
import {
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// A throttle rule and buckets keyed by the principal, a body field and a body proof; each test adds its routes.
const contract = (routes: string): string => `api: { name: mail, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  user: { schemes: { read: [bearer], write: [bearer] }, principal: UserPrincipal }
schemas:
  Message:
    type: object
    required: [to]
    properties: { to: { type: string }, count: { type: integer }, urgent: { type: boolean } }
  UserPrincipal: { type: object, required: [userId], properties: { userId: { type: string } } }
rules:
  throttle: { bucket: true }
  recentAuth: { proof: { in: body, name: reauthToken, schema: { type: string } } }
buckets:
  perUser: { key: [principal.userId] }
  perRecipient: { key: [body.to, address] }
  perCount: { key: [body.count] }
  perUrgency: { key: [body.urgent] }
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

  test("body keys name a string or integer field of the input or a body proof", () => {
    const { diagnostics } = run(`      send:
        method: post
        input: Message
        requires:
          - { rule: recentAuth }
          - { rule: throttle, bucket: perRecipient }
          - { rule: throttle, bucket: perCount }
          - { rule: throttle, bucket: perToken }
        responses: { 204: {} }
      ping:
        method: post
        requires: [{ rule: recentAuth }, { rule: throttle, bucket: perToken }]
        responses: { 204: {} }`);

    expect(diagnostics).toEqual([]);
  });

  test("a missing body field, a field of another type and a principal key on a public route are refused", () => {
    const { diagnostics } = run(`      send:
        method: post
        input: Message
        requires:
          - { rule: throttle, bucket: perUrgency }
          - { rule: throttle, bucket: perSubject }
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
      ["bucket-key", "/surfaces/app/routes/status/requires/0"],
      ["bucket-key", "/surfaces/app/routes/inbox/requires/0"],
      ["bucket-key", "/surfaces/app/routes/ping/requires/0"],
    ]);
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "bucket 'perUrgency' counts body.urgent on route 'send', whose input field 'urgent' is no string or integer",
      "bucket 'perSubject' counts body.subject on route 'send', whose input has no field 'subject'",
      "bucket 'perUser' counts principal.userId on route 'status', a public route, where the principal may be null",
      "bucket 'perUser' counts principal.userId on route 'inbox', an optional-auth route, where the principal may be null",
      "bucket 'perRecipient' counts body.to on route 'ping', whose input has no field 'to'",
    ]);
    expect(diagnostics[0]?.related.map((item) => item.origin.pointer)).toEqual([
      "/buckets/perUrgency/key/0",
    ]);
  });
});
