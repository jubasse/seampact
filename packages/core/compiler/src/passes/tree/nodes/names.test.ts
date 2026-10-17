import { expect, test } from "vitest";
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
        item: Member
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
  path: string;
  safe: boolean;
  op?: string;
  /** The status of the declared response; absent for the batch op, whose table response is derived. */
  status?: number;
}

const MEMBERS = "/v1/members";
const MEMBER = "/v1/members/{userId}";

// In tree order: the collection scope's ops then routes, the member scope's, then the single, then the root route.
// A route that declares no response answers 204.
const DEFAULT_ROWS: Row[] = [
  {
    id: "listMembers",
    segments: ["list", "members"],
    method: "get",
    path: MEMBERS,
    safe: true,
    op: "list",
    status: 200,
  },
  {
    id: "getMembersBatch",
    segments: ["get", "members", "batch"],
    method: "post",
    path: `${MEMBERS}/batch`,
    safe: true,
    op: "batch",
  },
  {
    id: "searchMembers",
    segments: ["search", "members"],
    method: "post",
    path: `${MEMBERS}/search`,
    safe: false,
    status: 204,
  },
  {
    id: "getMember",
    segments: ["get", "member"],
    method: "get",
    path: MEMBER,
    safe: true,
    op: "get",
    status: 200,
  },
  {
    id: "updateMember",
    segments: ["update", "member"],
    method: "patch",
    path: MEMBER,
    safe: false,
    op: "update",
    status: 200,
  },
  {
    id: "removeMember",
    segments: ["remove", "member"],
    method: "post",
    path: MEMBER,
    safe: false,
    op: "delete",
    status: 204,
  },
  {
    id: "promoteMember",
    segments: ["promote", "member"],
    method: "post",
    path: `${MEMBER}/promote`,
    safe: false,
    status: 204,
  },
  {
    id: "getMe",
    segments: ["get", "me"],
    method: "get",
    path: "/v1/me",
    safe: true,
    op: "get",
    status: 200,
  },
  {
    id: "avatarMe",
    segments: ["avatar", "me"],
    method: "get",
    path: "/v1/me/avatar",
    safe: true,
    status: 204,
  },
  { id: "ping", segments: ["ping"], method: "get", path: "/v1/ping", safe: true, status: 204 },
];

// The same tree with `conventions.ops` changing an op's path and statuses.
const OPS_CONVENTION_ROWS: Row[] = DEFAULT_ROWS.map((row) => {
  if (row.id === "listMembers") return { ...row, path: `${MEMBERS}/all`, status: 206 };
  if (row.id === "getMembersBatch") return { ...row, path: `${MEMBERS}/lookup` };
  if (row.id === "removeMember") return { ...row, status: 202 };
  return row;
});

const NOUN_VERB_SNAKE_ROWS: Row[] = DEFAULT_ROWS.map((row, index) => {
  const ids = [
    "members_list",
    "members_batch_get",
    "members_search",
    "member_get",
    "member_update",
    "removeMember",
    "member_promote",
    "me_get",
    "me_avatar",
    "ping",
  ];
  const segments = [
    ["members", "list"],
    ["members", "batch", "get"],
    ["members", "search"],
    ["member", "get"],
    ["member", "update"],
    ["remove", "member"],
    ["member", "promote"],
    ["me", "get"],
    ["me", "avatar"],
    ["ping"],
  ];
  const method = row.op === "update" ? "put" : row.method;
  return { ...row, id: ids[index] ?? "", segments: segments[index] ?? [], method };
});

const treeSchemas = treeNodesStubService({
  typeUses: {
    [UPDATE_MEMBER]: { kind: "ref", schema: "UpdateMember" },
    "/surfaces/app/routes/members/item": { kind: "ref", schema: "Member" },
    "/surfaces/app/routes/me/item": { kind: "ref", schema: "Member" },
  },
});

const rowsOf = (operations: readonly DraftOperation[]): Row[] =>
  operations.map(({ id, name, method, path, safe, op, responses }) => {
    const status = responses?.[0]?.status;
    return {
      id: id ?? "",
      segments: name?.segments ?? [],
      method: method ?? "",
      path: path ?? "",
      safe: safe ?? false,
      ...(op === undefined ? {} : { op }),
      ...(status === undefined ? {} : { status }),
    };
  });

test.each([
  { conventions: "", rows: DEFAULT_ROWS },
  {
    conventions:
      "conventions: { ops: { update: { method: put } }, operationIds: { order: nounVerb, case: snake } }",
    rows: NOUN_VERB_SNAKE_ROWS,
  },
  {
    conventions:
      "conventions: { ops: { list: { path: all, status: 206 }, batch: { path: lookup }, delete: { status: 202 } } }",
    rows: OPS_CONVENTION_ROWS,
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
  Task: { type: object, properties: { taskId: TaskId } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks: { kind: collection, id: { taskId: TaskId }, item: Task, ops: [get] }
      getTask: { method: get }
      archive: { method: post, operationId: get_task }
`;

test("operation ids are unique", () => {
  const workspace = treeNodesLoadInline(CLASHES);
  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas });

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
});

// ADR 0002 section 6: the singular comes from `singular` or `id`, never from the plural; the member scope of a
// collection needs `id`, its path parameter.
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
        ops: { list: {}, create: { input: Event } }
      logs:
        kind: collection
        item: Log
        ops: [list, create, get]
        member:
          routes:
            tail: { method: get }
`;

test("a collection whose operation names need a singular gives singular or id, its member scope id", () => {
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
    {
      rule: "seampact/tree/collection-id",
      origin: { layer: "api", pointer: "/surfaces/app/routes/logs" },
      message:
        "The collection logs declares no id, so the operation at /surfaces/app/routes/logs/ops/2 in its member scope has no member path.",
      fix: "Declare id on logs: its member id path parameter and schema.",
    },
  ]);

  const raw = treeNodesApiOf(workspace);
  const names = treeNodesOperationNames(raw, pipelineConventions(raw));
  expect([...names.values()].map(({ id }) => id)).toEqual([
    "listEvents",
    "createEvent",
    "listLogs",
  ]);
});
