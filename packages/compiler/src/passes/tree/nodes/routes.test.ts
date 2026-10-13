import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { DraftOperation } from "../../../pipeline/seam.js";
import {
  TREE_NODES_FIXTURES,
  treeNodesApiOf,
  treeNodesDraftWith,
  treeNodesHeaderUnion,
  treeNodesLoadDirectory,
  treeNodesLoadInline,
  treeNodesObjectSchema,
  treeNodesRun,
  treeNodesStubService,
} from "./test-support.js";

const text: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };
const flag: IrWriter.TypeUse = { kind: "scalar", type: "boolean", refinements: {} };
const opaque: IrWriter.TypeUse = {
  kind: "opaque",
  reason: "Vendor JSON.",
  origin: { layer: "api", pointer: "/x" },
};
const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });
const wire = (kind: IrWriter.QueryWireKind): IrWriter.QueryWire => ({
  kind,
  style: "form",
  explode: true,
  brackets: false,
});
const at = (pointer: string): IrWriter.Origin => ({ layer: "api", pointer });

const operation = (operations: readonly DraftOperation[], id: string): DraftOperation => {
  const found = operations.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no operation ${id}`);
  return found;
};

const rulesOf = (diagnostics: readonly { rule: string }[]): string[] =>
  diagnostics.map(({ rule }) => rule.replace("seampact/tree/", ""));

const PROJECTS = "/surfaces/app/routes/projects";

const PARAMS = `
api: { name: a, version: 1, kind: product }
schemas:
  OrgId: { type: string }
  Filter: { type: object, properties: { state: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    headers: { X-Tenant: { type: string } }
    routes:
      projects:
        kind: single
        path: 'orgs/{orgId}/projects/{projectId}'
        pathParams: { orgId: OrgId, projectId: OrgId }
        query: { verbose?: { type: boolean } }
        routes:
          show: { method: get, query: Filter }
          rename:
            method: post
            query: { dryRun?: { type: boolean } }
            headers: { x-tenant: { type: string } }
          misplaced: { method: get, path: 'x/{missing}', pathParams: { unused: OrgId } }
`;

test("declared params: path, query reaching safe routes, headers, each name once", () => {
  const workspace = treeNodesLoadInline(PARAMS);
  const filterState = "/schemas/Filter/properties/state";
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${PROJECTS}/pathParams/orgId`]: text,
      [`${PROJECTS}/pathParams/projectId`]: text,
      [`${PROJECTS}/query/verbose?`]: flag,
      [`${PROJECTS}/routes/show/query`]: ref("Filter"),
      [`${PROJECTS}/routes/rename/query/dryRun?`]: flag,
      [`${PROJECTS}/routes/rename/headers/x-tenant`]: text,
      [`${PROJECTS}/routes/misplaced/pathParams/unused`]: text,
      "/surfaces/app/headers/X-Tenant": text,
    },
    queryWires: {
      [`${PROJECTS}/query/verbose?`]: wire("boolean"),
      [`${PROJECTS}/routes/rename/query/dryRun?`]: wire("boolean"),
      [filterState]: wire("text"),
    },
  });
  const filter = treeNodesObjectSchema("Filter", "/schemas/Filter", { state: text });
  const state = filter.properties[0];
  if (state !== undefined) state.optional = true;

  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft: treeNodesDraftWith(filter),
  });

  const tenant = {
    name: "X-Tenant",
    type: text,
    required: true,
    origin: at("/surfaces/app/headers/X-Tenant"),
  };
  const pathParams = [
    { name: "orgId", type: text, required: true, origin: at(`${PROJECTS}/pathParams/orgId`) },
    {
      name: "projectId",
      type: text,
      required: true,
      origin: at(`${PROJECTS}/pathParams/projectId`),
    },
  ];
  const show = operation(draft.operations, "showProjects");
  expect(show.path).toBe("/v1/orgs/{orgId}/projects/{projectId}/show");
  expect(show.params).toEqual({
    path: pathParams,
    query: [
      {
        name: "verbose",
        type: flag,
        required: false,
        wire: wire("boolean"),
        origin: at(`${PROJECTS}/query/verbose?`),
      },
      { name: "state", type: text, required: false, wire: wire("text"), origin: at(filterState) },
    ],
    header: [tenant],
  });

  // A write route gets its own query only, and one header name twice (in any case) is refused.
  expect(operation(draft.operations, "renameProjects").params).toEqual({
    path: pathParams,
    query: [
      {
        name: "dryRun",
        type: flag,
        required: false,
        wire: wire("boolean"),
        origin: at(`${PROJECTS}/routes/rename/query/dryRun?`),
      },
    ],
    header: [tenant],
  });
  expect(diagnostics.map(({ rule, origin, message }) => ({ rule, origin, message }))).toEqual([
    {
      rule: "seampact/tree/param-unique",
      origin: at(`${PROJECTS}/routes/rename/headers/x-tenant`),
      message: "The request header x-tenant of renameProjects is declared twice.",
    },
    {
      rule: "seampact/tree/path-param",
      origin: at(`${PROJECTS}/routes/misplaced`),
      message:
        "The path /v1/orgs/{orgId}/projects/{projectId}/x/{missing} of misplacedProjects holds {missing}, which no pathParams or id declares.",
    },
    {
      rule: "seampact/tree/path-param",
      origin: at(`${PROJECTS}/routes/misplaced/pathParams/unused`),
      message:
        "The path parameter unused of misplacedProjects is not in its path /v1/orgs/{orgId}/projects/{projectId}/x/{missing}.",
    },
  ]);
});

test("unknown query keys: the nearest unknownQuery, else the convention, with its reason and origin", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
conventions:
  query: { unknownKeys: { ignore: "Gateways add tracking keys." } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      search: { method: get }
      strict: { method: get, unknownQuery: refuse }
      pages:
        kind: single
        unknownQuery: { ignore: "Marketing links add utm_* parameters." }
        routes:
          home: { method: get }
`);
  const { draft } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas: treeNodesStubService({}),
  });

  expect(draft.operations.map(({ id, unknownQuery }) => ({ id, unknownQuery }))).toEqual([
    {
      id: "search",
      unknownQuery: {
        policy: "ignore",
        reason: "Gateways add tracking keys.",
        origin: at("/conventions/query/unknownKeys"),
      },
    },
    { id: "strict", unknownQuery: { policy: "refuse" } },
    {
      id: "homePages",
      unknownQuery: {
        policy: "ignore",
        reason: "Marketing links add utm_* parameters.",
        origin: at("/surfaces/app/routes/pages/unknownQuery"),
      },
    },
  ]);
});

const TASKS = "/surfaces/app/routes/tasks";
const ROUTES = "/surfaces/app/routes";

test("declared responses: shapes, statuses sorted, headers and the format's media", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  TaskId: { type: string }
  Task: { type: object, properties: { taskId: TaskId } }
formats:
  envelope: { media: application/vnd.acme+json }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks:
        kind: collection
        id: { taskId: TaskId }
        item: Task
        ops: { list: { paging: none }, get: {}, delete: {} }
      export:
        method: post
        format: envelope
        responses:
          202: { headers: { Location: { type: string } } }
          200: { body: Task }
      download: { method: get, output: { file: { media: [text/csv] } } }
      feed: { method: get, item: Task }
`);
  const csv: IrWriter.TypeUse = { kind: "file", media: ["text/csv"] };
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${TASKS}/id/taskId`]: text,
      [`${TASKS}/item`]: ref("Task"),
      [`${ROUTES}/export/responses/200/body`]: ref("Task"),
      [`${ROUTES}/export/responses/202/headers/Location`]: text,
      [`${ROUTES}/download/output`]: csv,
      [`${ROUTES}/feed/item`]: ref("Task"),
    },
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  const json = "application/json";
  const item = { media: json, body: ref("Task"), headers: [], origin: at(`${TASKS}/item`) };
  expect(diagnostics).toEqual([]);
  expect(draft.operations.map(({ id, responses, format }) => ({ id, responses, format }))).toEqual([
    { id: "listTasks", responses: [{ status: 200, shape: "list", ...item }], format: "bare" },
    { id: "getTask", responses: [{ status: 200, shape: "item", ...item }], format: "bare" },
    {
      id: "deleteTask",
      responses: [{ status: 204, shape: "empty", headers: [], origin: at(`${TASKS}/ops/delete`) }],
      format: "bare",
    },
    {
      id: "export",
      responses: [
        {
          status: 200,
          media: "application/vnd.acme+json",
          body: ref("Task"),
          shape: "item",
          headers: [],
          origin: at(`${ROUTES}/export/responses/200`),
        },
        {
          status: 202,
          shape: "empty",
          headers: [
            {
              name: "Location",
              type: text,
              required: true,
              origin: at(`${ROUTES}/export/responses/202/headers/Location`),
            },
          ],
          origin: at(`${ROUTES}/export/responses/202`),
        },
      ],
      format: "envelope",
    },
    {
      id: "download",
      responses: [
        {
          status: 200,
          body: csv,
          shape: "binary",
          headers: [],
          origin: at(`${ROUTES}/download/output`),
        },
      ],
      format: "bare",
    },
    {
      id: "feed",
      responses: [
        {
          status: 200,
          shape: "page",
          media: json,
          body: ref("Task"),
          headers: [],
          origin: at(`${ROUTES}/feed/item`),
        },
      ],
      format: "bare",
    },
  ]);
});

test("ops inputs and idProperty", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Id: { type: string }
  Task: { type: object, properties: { taskId: Id } }
  Note: { type: object, properties: { text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks: { kind: collection, id: { taskId: Id }, item: Task, ops: [create, update] }
      notes: { kind: collection, id: { noteId: Id }, item: Note, ops: [get] }
      memos: { kind: collection, id: { memoId: Id }, idProperty: key, item: Note, ops: [get] }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/tasks/item`]: ref("Task"),
      [`${ROUTES}/notes/item`]: ref("Note"),
      [`${ROUTES}/memos/item`]: ref("Note"),
    },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("Task", "/schemas/Task", { taskId: text }),
    treeNodesObjectSchema("Note", "/schemas/Note", { text }),
  );
  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft,
  });

  expect(diagnostics.map(({ rule, origin, message }) => ({ rule, origin, message }))).toEqual([
    {
      rule: "seampact/tree/op-input",
      origin: at(`${ROUTES}/tasks/ops/0`),
      message:
        "The create op createTask has no input; the item schema holds fields a client never sends.",
    },
    {
      rule: "seampact/tree/op-input",
      origin: at(`${ROUTES}/tasks/ops/1`),
      message:
        "The update op updateTask has no input; the item schema holds fields a client never sends.",
    },
    {
      rule: "seampact/tree/id-property",
      origin: at(`${ROUTES}/notes/id/noteId`),
      message:
        "The item Note of the collection notes has no property noteId to hold the member id.",
    },
    {
      rule: "seampact/tree/id-property",
      origin: at(`${ROUTES}/memos/idProperty`),
      message: "The item Note of the collection memos has no property key to hold the member id.",
    },
  ]);
});

const GITHUB = `
api: { name: hooks, version: 1, kind: product }
schemas:
  Push: { type: object, properties: { ref: { type: string } } }
  Ping: { type: object, properties: { zen: { type: string } } }
  GithubEvent:
    discriminator: { from: header.X-GitHub-Event }
    oneOf: { push: Push, ping: Ping }
surfaces:
  app:
    prefix: /v{version}
    routes:
      accepted: { method: post, input: GithubEvent }
      github: { method: post, input: GithubEvent, headers: { x-github-event: { type: string } } }
      replay: { method: get, output: GithubEvent }
      search: { method: get, query: { events?: { type: array, items: GithubEvent } } }
`;

test("header-tagged unions: only a route's whole input, their header not declared again", () => {
  const workspace = treeNodesLoadInline(GITHUB);
  const events: IrWriter.TypeUse = { kind: "array", items: ref("GithubEvent") };
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/accepted/input`]: ref("GithubEvent"),
      [`${ROUTES}/github/input`]: ref("GithubEvent"),
      [`${ROUTES}/github/headers/x-github-event`]: text,
      [`${ROUTES}/replay/output`]: ref("GithubEvent"),
      [`${ROUTES}/search/query/events?`]: events,
    },
  });
  const draft = treeNodesDraftWith(treeNodesHeaderUnion("GithubEvent", "X-GitHub-Event"));
  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft,
  });

  expect(diagnostics.map(({ rule, origin, message }) => ({ rule, origin, message }))).toEqual([
    {
      rule: "seampact/tree/header-union",
      origin: at(`${ROUTES}/github/headers/x-github-event`),
      message:
        "The request header x-github-event of github is the tag of its input union, which adds it.",
    },
    {
      rule: "seampact/tree/header-union",
      origin: at(`${ROUTES}/replay/output`),
      message:
        "The response body of replay is a union tagged by a header, which only a route's whole input can be.",
    },
    {
      rule: "seampact/tree/header-union",
      origin: at(`${ROUTES}/search/query/events?`),
      message:
        "The query field events of search is a union tagged by a header, which only a route's whole input can be.",
    },
  ]);
});

test("redirects without a body", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Note: { type: object, properties: { text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      callback: { method: get, responses: { 302: {} } }
      submit: { method: post, responses: { 303: { body: Note } } }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: { [`${ROUTES}/submit/responses/303/body`]: ref("Note") },
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(draft.operations.map(({ responses }) => responses)).toEqual([
    [
      {
        status: 302,
        shape: "redirect",
        headers: [],
        origin: at(`${ROUTES}/callback/responses/302`),
      },
    ],
    [{ status: 303, shape: "redirect", headers: [], origin: at(`${ROUTES}/submit/responses/303`) }],
  ]);
  expect(diagnostics.map(({ rule, origin, message }) => ({ rule, origin, message }))).toEqual([
    {
      rule: "seampact/tree/redirect-body",
      origin: at(`${ROUTES}/submit/responses/303/body`),
      message: "The 303 response of submit is a redirect, which has no body.",
    },
  ]);
});

test("opaque outside parameters: no opaque value in a path parameter, a query field or a header", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
surfaces:
  app:
    prefix: /v{version}
    routes:
      hook:
        method: get
        path: 'raw/{raw}'
        pathParams: { raw: { opaque: "Vendor JSON." } }
        query: { payload: { opaque: "Vendor JSON." } }
        headers: { X-Meta: { opaque: "Vendor JSON." } }
        responses:
          200: { headers: { X-Trace: { opaque: "Vendor JSON." } } }
`);
  const hook = `${ROUTES}/hook`;
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${hook}/pathParams/raw`]: opaque,
      [`${hook}/query/payload`]: opaque,
      [`${hook}/headers/X-Meta`]: opaque,
      [`${hook}/responses/200/headers/X-Trace`]: opaque,
    },
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(draft.operations[0]?.params).toEqual({ path: [], query: [], header: [] });
  expect(draft.operations[0]?.responses?.[0]?.headers).toEqual([]);
  expect(diagnostics.map(({ rule, origin }) => ({ rule, origin }))).toEqual(
    [
      `${hook}/headers/X-Meta`,
      `${hook}/pathParams/raw`,
      `${hook}/query/payload`,
      `${hook}/responses/200/headers/X-Trace`,
    ].map((pointer) => ({ rule: "seampact/tree/opaque-parameter", origin: at(pointer) })),
  );
});

// One refusal of each route rule, each diagnostic located in the locations table, with a sentence and a fix.
test("tree.nodes diagnostics are located: routes", () => {
  const workspace = treeNodesLoadDirectory(`${TREE_NODES_FIXTURES}routes-refused/`);
  const raw = treeNodesApiOf(workspace);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/notes/item`]: ref("Note"),
      [`${ROUTES}/raw/query/payload`]: opaque,
      [`${ROUTES}/listed/query`]: text,
      [`${ROUTES}/hook/input`]: ref("GithubEvent"),
      [`${ROUTES}/hook/headers/X-GitHub-Event`]: text,
      [`${ROUTES}/moved/responses/301/body`]: ref("Note"),
    },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("Note", "/schemas/Note", { text }),
    treeNodesHeaderUnion("GithubEvent", "X-GitHub-Event"),
  );
  const { diagnostics } = treeNodesRun(raw, workspace, { treeSchemas, draft });

  expect([...new Set(rulesOf(diagnostics))].sort()).toEqual([
    "api-version",
    "body-limit",
    "collection-id",
    "fields-schema",
    "header-union",
    "id-property",
    "op-input",
    "op-item",
    "opaque-parameter",
    "param-unique",
    "path-param",
    "path-version",
    "redirect-body",
  ]);
  for (const diagnostic of diagnostics) {
    expect(diagnostic.message.endsWith(".")).toBe(true);
    expect(diagnostic.fix).not.toBe("");
    for (const origin of [
      diagnostic.origin,
      ...diagnostic.related.map((related) => related.origin),
    ])
      expect(Object.hasOwn(raw.locations, diagnosticLocationKey(origin))).toBe(true);
  }
});
