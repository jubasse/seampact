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
  MemberPrincipal: { type: object, required: [memberId], properties: { memberId: { type: string } } }
scopes:
  org: { id: OrgId }
  project: { id: ProjectId, within: org }
  board: { id: ProjectId, within: project }
rights:
  orgMember: { subject: { scope: org } }
  projectRole: { subject: { scope: project } }
  docs.edit: { subject: { resource: Doc, id: DocId } }
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
