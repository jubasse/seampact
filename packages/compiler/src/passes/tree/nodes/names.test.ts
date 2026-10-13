import { expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import { type DraftOperation, pipelineConventions } from "../../../pipeline/seam.js";
import { treeNodesOperationNames } from "./names.js";
import {
  TREE_NODES_FIXTURES,
  treeNodesApiOf,
  treeNodesLoadDirectory,
  treeNodesLoadInline,
  treeNodesRun,
  treeNodesStubService,
} from "./test-support.js";

const UPDATE_MEMBER = "/surfaces/app/routes/members/ops/update/input";

// The tree of the ops-and-ids fixture, under the conventions each row writes.
function contract(conventions: string): string {
  return `
api: { name: shop, version: 1, kind: product }
${conventions}
schemas:
  UserId: { type: string }
  Member:
    type: object
    required: [userId]
    properties:
      userId: UserId
      role: { type: string }
  UpdateMember:
    type: object
    properties:
      role: { type: string }
surfaces:
  app:
    prefix: /v{version}
    routes:
      members:
        kind: collection
        id: { userId: UserId }
        singular: member
        item: Member
        ops:
          list: {}
          get: {}
          update: { input: UpdateMember }
          delete: { method: post, operationId: removeMember }
          batch: {}
        collection:
          routes:
            search: { method: post }
        member:
          routes:
            promote: { method: post }
      me:
        kind: single
        ops: [get]
        routes:
          avatar: { method: get }
      ping: { method: get }
`;
}

interface Row {
  id: string;
  segments: string[];
  method: string;
  safe: boolean;
  op?: string;
}

// In tree order: the collection scope's ops then routes, the member scope's, then the single, then the root route.
const DEFAULT_ROWS: Row[] = [
  { id: "listMembers", segments: ["list", "members"], method: "get", safe: true, op: "list" },
  {
    id: "getMembersBatch",
    segments: ["get", "members", "batch"],
    method: "post",
    safe: true,
    op: "batch",
  },
  { id: "searchMembers", segments: ["search", "members"], method: "post", safe: false },
  { id: "getMember", segments: ["get", "member"], method: "get", safe: true, op: "get" },
  {
    id: "updateMember",
    segments: ["update", "member"],
    method: "patch",
    safe: false,
    op: "update",
  },
  { id: "removeMember", segments: ["remove", "member"], method: "post", safe: false, op: "delete" },
  { id: "promoteMember", segments: ["promote", "member"], method: "post", safe: false },
  { id: "getMe", segments: ["get", "me"], method: "get", safe: true, op: "get" },
  { id: "avatarMe", segments: ["avatar", "me"], method: "get", safe: true },
  { id: "ping", segments: ["ping"], method: "get", safe: true },
];

const NOUN_VERB_SNAKE_ROWS: Row[] = [
  { id: "members_list", segments: ["members", "list"], method: "get", safe: true, op: "list" },
  {
    id: "members_batch_get",
    segments: ["members", "batch", "get"],
    method: "post",
    safe: true,
    op: "batch",
  },
  { id: "members_search", segments: ["members", "search"], method: "post", safe: false },
  { id: "member_get", segments: ["member", "get"], method: "get", safe: true, op: "get" },
  { id: "member_update", segments: ["member", "update"], method: "put", safe: false, op: "update" },
  { id: "removeMember", segments: ["remove", "member"], method: "post", safe: false, op: "delete" },
  { id: "member_promote", segments: ["member", "promote"], method: "post", safe: false },
  { id: "me_get", segments: ["me", "get"], method: "get", safe: true, op: "get" },
  { id: "me_avatar", segments: ["me", "avatar"], method: "get", safe: true },
  { id: "ping", segments: ["ping"], method: "get", safe: true },
];

const treeSchemas = treeNodesStubService({
  typeUses: { [UPDATE_MEMBER]: { kind: "ref", schema: "UpdateMember" } },
});

const rowsOf = (operations: readonly DraftOperation[]): Row[] =>
  operations.map(({ id, name, method, safe, op }) => ({
    id: id ?? "",
    segments: name?.segments ?? [],
    method: method ?? "",
    safe: safe ?? false,
    ...(op === undefined ? {} : { op }),
  }));

test.each([
  { conventions: "", rows: DEFAULT_ROWS },
  {
    conventions:
      "conventions: { ops: { update: { method: put } }, operationIds: { order: nounVerb, case: snake } }",
    rows: NOUN_VERB_SNAKE_ROWS,
  },
])("ops expand to routes ($conventions)", ({ conventions, rows }) => {
  const workspace = treeNodesLoadInline(contract(conventions));
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(diagnostics).toEqual([]);
  expect(rowsOf(draft.operations)).toEqual(rows);
});

test("ops expand to routes (fixture ops-and-ids)", () => {
  const workspace = treeNodesLoadDirectory(`${TREE_NODES_FIXTURES}ops-and-ids/`);
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(diagnostics).toEqual([]);
  expect(rowsOf(draft.operations)).toEqual(NOUN_VERB_SNAKE_ROWS);
  expect(draft.operations[3]?.resource).toEqual({
    type: "members",
    idParam: "userId",
    idProperty: "userId",
  });
  expect(draft.operations[4]?.input).toEqual({
    media: "application/json",
    schema: { kind: "ref", schema: "UpdateMember" },
    origin: { layer: "api", pointer: UPDATE_MEMBER },
  });
});

test("treeNodesOperationNames keys every operation by its route pointer", () => {
  const raw = treeNodesApiOf(treeNodesLoadInline(contract("")));
  const names = treeNodesOperationNames(raw, pipelineConventions(raw));

  expect(names.get("/surfaces/app/routes/members/ops/batch")).toEqual({
    id: "getMembersBatch",
    name: { segments: ["get", "members", "batch"], role: "operation" },
  });
  expect(names.get("/surfaces/app/routes/members/member/routes/promote")?.id).toBe("promoteMember");
  expect(names.get("/surfaces/app/routes/me/ops/0")?.id).toBe("getMe");
  expect([...names.values()].map(({ id }) => id)).toEqual(DEFAULT_ROWS.map(({ id }) => id));
});

test("a relay route is named by its route name or its operationId", () => {
  const raw = treeNodesApiOf(
    treeNodesLoadInline(`
api: { name: svc, version: 1, kind: service }
surfaces:
  internal:
    prefix: /internal/v{version}
    routes:
      getTask: { relays: tasks.getTask }
      getBillingTask: { relays: billing.getTask, operationId: fetchBillingTask }
`),
  );
  const names = treeNodesOperationNames(raw, pipelineConventions(raw));

  expect([...names.values()]).toEqual([
    { id: "getTask", name: { segments: ["get", "task"], role: "operation" } },
    { id: "fetchBillingTask", name: { segments: ["fetch", "billing", "task"], role: "operation" } },
  ]);
});

const CLASHES = `
api: { name: a, version: 1, kind: product }
schemas:
  TaskId: { type: string }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks: { kind: collection, id: { taskId: TaskId }, ops: [get] }
      getTask: { method: get }
      archive: { method: post, operationId: get_task }
`;

test("operation ids are unique", () => {
  const workspace = treeNodesLoadInline(CLASHES);
  const raw = treeNodesApiOf(workspace);
  const { diagnostics } = treeNodesRun(raw, workspace, { treeSchemas });

  expect(diagnostics.map(({ rule, origin, related }) => ({ rule, origin, related }))).toEqual([
    {
      rule: "seampact/tree/operation-id-unique",
      origin: { layer: "api", pointer: "/surfaces/app/routes/getTask" },
      related: [
        {
          origin: { layer: "api", pointer: "/surfaces/app/routes/tasks/ops/0" },
          message: "the operation getTask",
        },
      ],
    },
    {
      rule: "seampact/tree/operation-name-unique",
      origin: { layer: "api", pointer: "/surfaces/app/routes/archive" },
      related: [
        {
          origin: { layer: "api", pointer: "/surfaces/app/routes/tasks/ops/0" },
          message: "the operation getTask",
        },
      ],
    },
  ]);

  for (const diagnostic of diagnostics) {
    expect(diagnostic.message.endsWith(".")).toBe(true);
    expect(diagnostic.fix).not.toBe("");
    for (const origin of [diagnostic.origin, ...diagnostic.related.map((r) => r.origin)])
      expect(Object.hasOwn(raw.locations, diagnosticLocationKey(origin))).toBe(true);
  }
});

// ADR 0002 section 6: the singular comes from `singular` or `id`, never from the plural.
const SINGULARS = `
api: { name: a, version: 1, kind: product }
schemas:
  Event: { type: object, properties: { eventKey: { type: string } } }
  Log: { type: object, properties: { line: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      events:
        kind: collection
        singular: event
        idProperty: eventKey
        item: Event
        ops: [list, create]
      logs:
        kind: collection
        item: Log
        ops: [list, create, get]
        member:
          routes:
            tail: { method: get }
`;

test("a collection whose operation names need a singular gives singular or id", () => {
  const workspace = treeNodesLoadInline(SINGULARS);
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(draft.operations.map(({ id, resource }) => ({ id, resource }))).toEqual([
    { id: "listEvents", resource: { type: "events", idProperty: "eventKey" } },
    { id: "createEvent", resource: { type: "events", idProperty: "eventKey" } },
    { id: "listLogs", resource: { type: "logs" } },
  ]);
  expect(
    diagnostics.map(({ rule, origin, message, fix }) => ({ rule, origin, message, fix })),
  ).toEqual([
    {
      rule: "seampact/tree/collection-singular",
      origin: { layer: "api", pointer: "/surfaces/app/routes/logs" },
      message:
        "The collection logs declares neither singular nor id, so the operation at /surfaces/app/routes/logs/ops/1 has no singular noun for its name.",
      fix: "Set singular on the collection (or declare its id).",
    },
  ]);
});
