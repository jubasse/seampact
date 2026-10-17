import { describe, expect, test } from "vitest";
import { DRAFT_FIXTURE_INVALID_EXAMPLE } from "../../../pipeline/draft-fixture.js";
import {
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// Rights and rules without subjects, so each test is about the requirement itself; each test adds its routes.
const contract = (surface: string): string => `api: { name: shop, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  user: { schemes: { read: [bearer], write: [bearer] }, principal: UserPrincipal }
schemas:
  UserPrincipal: { type: object, required: [userId], properties: { userId: { type: string } } }
rights:
  shop.open: {}
  staff: { params: { level: { type: integer } } }
rules:
  throttle: { bucket: true }
  audit: {}
buckets:
  perUser: { key: [principal.userId] }
requirements:
  seniorStaff: { right: staff, params: { level: 3 } }
  writeThrottle: { rule: throttle, bucket: perUser }
surfaces:
  app:
    prefix: /v{version}
    identity: user
${surface}`;

const run = (surface: string) =>
  accessRightsRunContract(accessRightsLoadFiles({ "api.yaml": contract(surface) }));

const located = (diagnostics: readonly { rule: string; origin: { pointer: string } }[]) =>
  diagnostics.map(({ rule, origin }) => [rule, origin.pointer]);

describe("requirements in order", () => {
  test("the ancestors' from the root down, then the route's own, entries expanded where they are used", () => {
    const { draft, diagnostics } = run(`    requires: [{ rule: audit }]
    routes:
      orders:
        kind: single
        requires: [seniorStaff]
        routes:
          refund:
            method: post
            requires: [writeThrottle, { right: shop.open }, { right: staff, params: { level: 1 } }]
`);

    expect(diagnostics).toEqual([]);
    expect(draft.operations[0]?.requires).toEqual([
      { kind: "rule", rule: "audit", origin: { layer: "api", pointer: "/surfaces/app/requires/0" } },
      {
        kind: "right",
        right: "staff",
        params: { level: 3 },
        entry: "seniorStaff",
        origin: { layer: "api", pointer: "/surfaces/app/routes/orders/requires/0" },
      },
      {
        kind: "rule",
        rule: "throttle",
        bucket: "perUser",
        entry: "writeThrottle",
        origin: { layer: "api", pointer: "/surfaces/app/routes/orders/routes/refund/requires/0" },
      },
      {
        kind: "right",
        right: "shop.open",
        origin: { layer: "api", pointer: "/surfaces/app/routes/orders/routes/refund/requires/1" },
      },
      {
        kind: "right",
        right: "staff",
        params: { level: 1 },
        origin: { layer: "api", pointer: "/surfaces/app/routes/orders/routes/refund/requires/2" },
      },
    ]);
  });

  test("unknown entries and targets, params, buckets and an equal requirement twice are errors", () => {
    const { draft, diagnostics } = run(`    routes:
      refund:
        method: post
        requires:
          - managerOnly
          - { right: shop.close }
          - { rule: captcha }
          - { right: shop.open, params: { now: true } }
          - { right: staff, params: { level: ${DRAFT_FIXTURE_INVALID_EXAMPLE} } }
          - { rule: throttle }
          - { rule: audit, bucket: perUser }
          - { rule: throttle, bucket: perDay }
          - seniorStaff
          - { right: staff, params: { level: 3 } }
`);
    const at = (index: number, member?: string) =>
      `/surfaces/app/routes/refund/requires/${index}${member === undefined ? "" : `/${member}`}`;

    expect(located(diagnostics)).toEqual([
      ["seampact/access/requirement-entry", at(0)],
      ["seampact/access/requirement-target", at(1, "right")],
      ["seampact/access/requirement-target", at(2, "rule")],
      ["seampact/access/requirement-params", at(3, "params")],
      ["seampact/access/requirement-params", at(4, "params")],
      ["seampact/access/requirement-bucket", at(5)],
      ["seampact/access/requirement-bucket", at(6, "bucket")],
      ["seampact/access/requirement-bucket", at(7, "bucket")],
      ["seampact/access/requirement-twice", at(9)],
    ]);
    expect(diagnostics.at(-1)?.related).toEqual([
      {
        origin: { layer: "api", pointer: at(8) },
        message: "first required here",
      },
    ]);
    expect(draft.operations[0]?.requires).toEqual([
      {
        kind: "right",
        right: "staff",
        params: { level: 3 },
        entry: "seniorStaff",
        origin: { layer: "api", pointer: at(8) },
      },
    ]);
  });

  test("an item inherited by several routes is checked, and reported, once", () => {
    const { diagnostics } = run(`    requires: [{ right: shop.close }]
    routes:
      first: { method: get }
      second: { method: get }
`);

    expect(located(diagnostics)).toEqual([
      ["seampact/access/requirement-target", "/surfaces/app/requires/0/right"],
    ]);
  });
});

describe("guest rights on public routes", () => {
  test("a rule and a guest right reach anonymous callers; a right without a guest reason is an error", () => {
    const { draft, diagnostics } = accessRightsRunContract(accessRightsLoadFixture("guest"));

    expect(located(diagnostics)).toEqual([
      [
        "seampact/access/guest-right",
        "/surfaces/app/routes/articles/member/routes/preview/requires/1",
      ],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "right 'articles.edit' is required on optional-auth route 'previewArticle', where an anonymous caller reaches it, and the right has no 'guest' reason",
    );
    expect(diagnostics[0]?.related).toEqual([
      {
        origin: { layer: "api", pointer: "/surfaces/app/routes/articles/member/routes/preview/access" },
        message: "the route's access is set here",
      },
    ]);
    expect(
      draft.operations.map((operation) => [
        operation.id,
        operation.requires?.map((requirement) =>
          requirement.kind === "right" ? requirement.right : requirement.rule,
        ),
      ]),
    ).toEqual([
      ["getArticle", ["throttle", "articles.read"]],
      ["previewArticle", ["articles.read"]],
      ["publishArticle", ["articles.edit"]],
    ]);
    expect(draft.rights["articles.read"]?.guest).toBe(
      "Published articles are readable without an account.",
    );
  });
});

describe("service api caller right", () => {
  test("every route of a service api requires its caller right", () => {
    const { draft, diagnostics } = accessRightsRunContract(accessRightsLoadFixture("service"));

    expect(located(diagnostics)).toEqual([
      ["seampact/access/caller-right", "/surfaces/maintenance/routes/reindex"],
    ]);
    expect(diagnostics[0]?.related).toEqual([
      {
        origin: { layer: "api", pointer: "/api/caller/right" },
        message: "the caller right is set here",
      },
    ]);
    expect(draft.operations[0]?.requires).toEqual([
      {
        kind: "right",
        right: "callerService",
        params: { allowed: ["catalog"] },
        origin: { layer: "api", pointer: "/surfaces/internal/requires/0" },
      },
    ]);
  });
});
