import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  ACCESS_RIGHTS_FIXTURES,
  accessRightsLoadFiles,
  accessRightsLoadFixture,
  accessRightsRunContract,
} from "./test-support.js";

// A contract with three nested scopes and two resource rights over uuid ids of different schemas; each test adds
// the routes it needs under the surface.
const contract = (routes: string): string => `api: { name: studio, version: 1 }
schemes:
  bearer: { kind: bearer }
identities:
  member: { schemes: { read: [bearer], write: [bearer] }, principal: MemberPrincipal }
schemas:
  OrgId: { type: string, format: uuid }
  ProjectId: { type: string, format: uuid }
  DocId: { type: string, format: uuid }
  Doc: { type: object, required: [docId], properties: { docId: DocId } }
  MemberProfile: { type: object, required: [docId], properties: { docId: DocId } }
  MemberPrincipal:
    type: object
    required: [memberId, profile]
    properties: { memberId: { type: string }, profile: MemberProfile }
scopes:
  org: { id: OrgId }
  project: { id: ProjectId, within: org }
  board: { id: ProjectId, within: project }
rights:
  orgMember: { subject: { scope: org } }
  projectRole: { subject: { scope: project } }
  docs.edit: { subject: { resource: Doc, id: DocId } }
  docs.read: { subject: { resource: Doc, id: DocId }, guest: Published docs are public. }
  notes.edit: { subject: { resource: Note, id: { type: string, format: uuid } } }
  projects.edit: { subject: { resource: Project, id: ProjectId } }
  audit: {}
surfaces:
  app:
    prefix: /v{version}
    identity: member
    routes:
${routes}`;

const run = (routes: string) =>
  accessRightsRunContract(accessRightsLoadFiles({ "api.yaml": contract(routes) }));

const located = (diagnostics: readonly { rule: string; origin: { pointer: string } }[]) =>
  diagnostics.map(({ rule, origin }) => [rule, origin.pointer]);

describe("subjects and scopes", () => {
  test("scopes in resolution order and subjects defaulted or read, on the tenant fixture", () => {
    const { draft, diagnostics } = accessRightsRunContract(accessRightsLoadFixture("tenant"));
    const expected = JSON.parse(
      readFileSync(`${ACCESS_RIGHTS_FIXTURES}tenant/operations.json`, "utf8"),
    );

    expect(diagnostics).toEqual([]);
    expect(
      Object.fromEntries(
        draft.operations.map((operation) => [
          operation.id,
          { scopes: operation.scopes, requires: operation.requires },
        ]),
      ),
    ).toEqual(expected);
  });

  test("a resource subject defaults to a member id of its own schema only, never one of the same type", () => {
    const { diagnostics } = run(`      projects:
        kind: collection
        id: { projectId: ProjectId }
        member:
          routes:
            touch: { method: post, requires: [{ right: docs.edit }] }
`);

    expect(located(diagnostics)).toEqual([
      [
        "seampact/access/requirement-subject",
        "/surfaces/app/routes/projects/member/routes/touch/requires/0",
      ],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "right 'docs.edit' needs a subject on route 'touchProject', and no member id of the route has its id schema",
    );
  });

  test("a written subject whose schema is not the right's id schema is an error naming both", () => {
    const { diagnostics } = run(`      projects:
        kind: collection
        id: { projectId: ProjectId }
        member:
          routes:
            touch: { method: post, requires: [{ right: docs.edit, subject: path.projectId }] }
`);

    expect(located(diagnostics)).toEqual([
      [
        "seampact/access/requirement-subject",
        "/surfaces/app/routes/projects/member/routes/touch/requires/0/subject",
      ],
    ]);
    expect(diagnostics[0]?.message).toBe(
      "the subject path.projectId of right 'docs.edit' is 'ProjectId', not the right's id schema 'DocId'",
    );
  });

  test("a named id schema never equals an inline one, as a default or as a written subject", () => {
    const { diagnostics } = run(`      docs:
        kind: collection
        id: { docId: { type: string, format: uuid } }
        member:
          headers: { X-Doc: { type: string, format: uuid } }
          routes:
            touch: { method: post, requires: [{ right: docs.edit }] }
            poke: { method: post, requires: [{ right: docs.edit, subject: header.X-Doc }] }
`);

    expect(located(diagnostics)).toEqual([
      [
        "seampact/access/requirement-subject",
        "/surfaces/app/routes/docs/member/routes/touch/requires/0",
      ],
      [
        "seampact/access/requirement-subject",
        "/surfaces/app/routes/docs/member/routes/poke/requires/0/subject",
      ],
    ]);
    expect(diagnostics[1]?.message).toBe(
      "the subject header.X-Doc of right 'docs.edit' is an inline scalar schema, not the right's id schema 'DocId'",
    );
  });

  test("an inline id schema defaults to the nearest member id of the same inline shape", () => {
    const { draft, diagnostics } = run(`      folders:
        kind: collection
        id: { folderId: { type: string, format: uuid } }
        member:
          routes:
            notes:
              kind: collection
              id: { noteId: { type: string, format: uuid } }
              member:
                routes:
                  touch: { method: post, requires: [{ right: notes.edit }] }
`);

    expect(diagnostics).toEqual([]);
    expect(draft.operations[0]?.requires?.[0]).toMatchObject({
      right: "notes.edit",
      subject: { source: { in: "path", name: "noteId" }, defaulted: true },
    });
  });

  test("two member ids of the right's id schema in the nearest collection make the default ambiguous", () => {
    const { diagnostics } = run(`      links:
        kind: collection
        id: { fromId: DocId, toId: DocId }
        member:
          routes:
            touch: { method: post, requires: [{ right: docs.edit }] }
`);

    expect(located(diagnostics)).toEqual([
      [
        "seampact/access/requirement-subject",
        "/surfaces/app/routes/links/member/routes/touch/requires/0",
      ],
    ]);
    expect(diagnostics[0]?.message).toContain("ambiguous default subject");
    expect(diagnostics[0]?.related.map(({ origin }) => origin.pointer)).toEqual([
      "/surfaces/app/routes/links/id/fromId",
      "/surfaces/app/routes/links/id/toId",
    ]);
  });

  test("an optional query field or header is refused as a subject, a required one is read", () => {
    const { draft, diagnostics } = run(`      ping:
        method: post
        query: { docId?: DocId, mainDoc: DocId }
        headers: { X-Doc?: DocId }
        requires:
          - { right: docs.edit, subject: query.docId }
          - { right: docs.edit, subject: header.X-Doc }
          - { right: docs.edit, subject: query.mainDoc }
`);

    expect(located(diagnostics)).toEqual([
      ["seampact/access/requirement-subject", "/surfaces/app/routes/ping/requires/0/subject"],
      ["seampact/access/requirement-subject", "/surfaces/app/routes/ping/requires/1/subject"],
    ]);
    expect(diagnostics[0]?.message).toContain("the subject must be a required field");
    expect(
      draft.operations[0]?.requires?.map(
        (requirement) => requirement.kind === "right" && requirement.subject?.source,
      ),
    ).toEqual([{ in: "query", name: "mainDoc" }]);
  });

  test("a principal subject is refused on an optional-auth route and read through nested fields elsewhere", () => {
    const { draft, diagnostics } = run(`      reader:
        method: get
        access: { optionalAuth: Signed-in readers see more. }
        requires: [{ right: docs.read, subject: principal.profile.docId }]
      writer:
        method: post
        requires: [{ right: docs.edit, subject: principal.profile.docId }]
`);

    expect(located(diagnostics)).toEqual([
      ["seampact/access/requirement-subject", "/surfaces/app/routes/reader/requires/0/subject"],
    ]);
    expect(draft.operations[1]?.requires?.[0]).toMatchObject({
      right: "docs.edit",
      subject: { source: { in: "principal", name: "profile.docId" }, defaulted: false },
    });
  });

  test("a resource subject read from a resolved scope of its id schema", () => {
    const { draft, diagnostics } = run(`      projects:
        kind: collection
        id: { projectId: ProjectId }
        member:
          scopes: { project: path.projectId, org: subdomain }
          routes:
            touch: { method: post, requires: [{ right: projects.edit, subject: scope.project }] }
`);

    expect(diagnostics).toEqual([]);
    expect(draft.operations[0]?.requires?.[0]).toMatchObject({
      subject: { source: { in: "scope", name: "project" }, defaulted: false },
    });
  });

  test("subjects that read nothing the route has, or that a right without subject or a scope right refuses", () => {
    const { diagnostics } = run(`      ping:
        method: post
        scopes: { org: subdomain }
        requires:
          - { right: docs.edit, subject: header.X-Missing }
          - { right: audit, subject: path.orgId }
          - { right: orgMember, subject: principal.memberId }
          - { right: projectRole }
`);

    expect(located(diagnostics)).toEqual([
      ["seampact/access/requirement-subject", "/surfaces/app/routes/ping/requires/0/subject"],
      ["seampact/access/requirement-subject", "/surfaces/app/routes/ping/requires/1/subject"],
      ["seampact/access/requirement-subject", "/surfaces/app/routes/ping/requires/2/subject"],
      ["seampact/access/requirement-subject", "/surfaces/app/routes/ping/requires/3"],
    ]);
    expect(diagnostics[3]?.message).toBe(
      "right 'projectRole' is checked against scope 'project', which route 'ping' does not resolve",
    );
  });

  test("a scope subject error inherited by two routes is reported once, at the item", () => {
    const { diagnostics } = run(`      ping:
        kind: single
        requires: [{ right: projectRole }]
        routes:
          first: { method: get }
          second: { method: post }
`);

    expect(located(diagnostics)).toEqual([
      ["seampact/access/requirement-subject", "/surfaces/app/routes/ping/requires/0"],
    ]);
  });

  test("a right on a refused scope adds no error where it is required", () => {
    const { diagnostics } = accessRightsRunContract(
      accessRightsLoadFiles({
        "api.yaml": contract(`      ping:
        method: post
        scopes: { team: resolver }
        requires: [{ right: teamRole }]
`)
          .replace("  audit: {}\n", "  audit: {}\n  teamRole: { subject: { scope: team } }\n")
          .replace("  board:", "  team: { id: ProjectId, within: nowhere }\n  board:"),
      }),
    );

    expect(located(diagnostics)).toEqual([["seampact/access/scope-within", "/scopes/team/within"]]);
  });

  test("a scope entered twice, below its own child, or not declared is an error naming both places", () => {
    const { draft, diagnostics } = run(`      projects:
        kind: collection
        id: { projectId: ProjectId }
        scopes: { project: path.projectId }
        member:
          scopes: { project: path.projectId, org: subdomain, team: resolver }
          routes:
            ping: { method: get }
`);

    expect(located(diagnostics)).toEqual([
      ["seampact/access/scope-unknown", "/surfaces/app/routes/projects/member/scopes/team"],
      ["seampact/access/scope-nesting", "/surfaces/app/routes/projects/member/scopes/org"],
      ["seampact/access/scope-twice", "/surfaces/app/routes/projects/member/scopes/project"],
    ]);
    expect(diagnostics[1]?.related).toEqual([
      {
        origin: { layer: "api", pointer: "/surfaces/app/routes/projects/scopes/project" },
        message: "'project' is entered here",
      },
    ]);
    expect(draft.operations[0]?.scopes?.map(({ scope }) => scope)).toEqual(["project"]);
  });
});
