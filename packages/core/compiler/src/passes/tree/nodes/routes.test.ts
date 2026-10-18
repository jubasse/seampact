import type { IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import type { DraftOperation } from "../../../pipeline/seam.js";
import { treeSchemasRunApi } from "../schemas/test-support.js";
import {
  TREE_NODES_CURSOR_PAGING,
  TREE_NODES_FIXTURES,
  treeNodesApiOf,
  treeNodesDraftWith,
  treeNodesHeaderUnion,
  treeNodesLoadDirectory,
  treeNodesLoadInline,
  treeNodesObjectSchema,
  treeNodesRun,
  treeNodesStrictStubService,
  treeNodesStubService,
} from "./test-support.js";

const text: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };
const integer: IrWriter.TypeUse = { kind: "scalar", type: "integer", refinements: {} };
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
// A response that travels in a format records it (`response.format`).
const viaFormat = (format: IrWriter.Origin) => ({
  derivedFrom: { derivation: "response.format", from: [format] },
});

const operation = (operations: readonly DraftOperation[], id: string): DraftOperation => {
  const found = operations.find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`no operation ${id}`);

  return found;
};

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
      origin: at(`${PROJECTS}/routes/misplaced/path`),
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
${TREE_NODES_CURSOR_PAGING}
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
  const bare = viaFormat({ layer: "core", pointer: "/formats/bare" });
  const envelope = viaFormat(at("/formats/envelope"));
  const item = {
    media: json,
    body: ref("Task"),
    headers: [],
    origin: at(`${TASKS}/item`),
    ...bare,
  };

  expect(diagnostics).toEqual([]);
  expect(draft.operations.map(({ id, responses, format }) => ({ id, responses, format }))).toEqual([
    { id: "listTasks", responses: [{ status: 200, shape: "list", ...item }], format: "bare" },
    { id: "getTask", responses: [{ status: 200, shape: "item", ...item }], format: "bare" },
    {
      id: "deleteTask",
      responses: [
        { status: 204, shape: "empty", headers: [], origin: at(`${TASKS}/ops/delete`), ...bare },
      ],
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
          ...envelope,
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
          ...envelope,
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
          ...bare,
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

test("header-tagged unions: tree.schemas refuses them off the whole input, tree.nodes their tag header declared again", () => {
  // The real tree.schemas reports every route position but the whole input, so tree.nodes checks only the params.
  const schemas = treeSchemasRunApi(GITHUB.replace(/^\napi: .*\n/, "\n"));

  expect(schemas.diagnostics.map(({ rule, origin }) => ({ rule, origin }))).toEqual([
    { rule: "seampact/tree/union-header", origin: at(`${ROUTES}/replay/output`) },
    { rule: "seampact/tree/union-header", origin: at(`${ROUTES}/search/query/events?/items`) },
  ]);

  const workspace = treeNodesLoadInline(GITHUB);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/accepted/input`]: ref("GithubEvent"),
      [`${ROUTES}/github/input`]: ref("GithubEvent"),
      [`${ROUTES}/github/headers/x-github-event`]: text,
    },
  });
  const draft = treeNodesDraftWith(treeNodesHeaderUnion("GithubEvent", "X-GitHub-Event"));
  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
    draft,
  });

  expect(diagnostics.map(({ rule, origin, message }) => ({ rule, origin, message }))).toEqual([
    {
      rule: "seampact/tree/union-header",
      origin: at(`${ROUTES}/github/headers/x-github-event`),
      message:
        "The request header x-github-event of github is the tag of its input union, which adds it.",
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
    ].map((pointer) => ({ rule: "seampact/tree/opaque-position", origin: at(pointer) })),
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
      [`${ROUTES}/batch/query/payloads`]: { kind: "array", items: opaque },
      [`${ROUTES}/attached/headers/X-File`]: { kind: "file", media: [] },
      [`${ROUTES}/shadowed/pathParams/itemId`]: text,
      [`${ROUTES}/shadowed/query/itemId?`]: text,
      [`${ROUTES}/shadowed/query/tags?`]: { kind: "array", items: text },
      [`${ROUTES}/both/output`]: ref("Note"),
      [`${ROUTES}/both/responses/200/body`]: ref("Note"),
      [`${ROUTES}/emptied/responses/204/body`]: ref("Note"),
    },
    queryWires: { [`${ROUTES}/shadowed/query/itemId?`]: wire("text") },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("Note", "/schemas/Note", { text }),
    treeNodesHeaderUnion("GithubEvent", "X-GitHub-Event"),
  );
  const { diagnostics } = treeNodesRun(raw, workspace, { treeSchemas, draft });

  // Every rule once at least, each at the pointer that writes the refused value.
  expect(
    diagnostics.map(({ rule, origin }) => [rule.replace("seampact/tree/", ""), origin.pointer]),
  ).toEqual([
    ["path-version", "/surfaces/app/prefix"],
    ["api-version", "/api/version"],
    ["body-limit", `${ROUTES}/upload/bodyLimit`],
    ["op-input", `${ROUTES}/notes/ops/0`],
    ["collection-id", `${ROUTES}/logs`],
    ["op-item", `${ROUTES}/drafts/ops/0`],
    ["opaque-position", `${ROUTES}/raw/query/payload`],
    ["opaque-position", `${ROUTES}/batch/query/payloads`],
    ["opaque-position", `${ROUTES}/attached/headers/X-File`],
    ["param-unique", `${ROUTES}/shadowed/query/itemId?`],
    ["query-field", `${ROUTES}/shadowed/query/tags?`],
    ["path-segment", `${ROUTES}/rooted/path`],
    ["responses-output", `${ROUTES}/both/output`],
    ["no-content-body", `${ROUTES}/emptied/responses/204`],
    ["fields-schema", `${ROUTES}/listed/query`],
    ["path-param", `${ROUTES}/misplaced/path`],
    ["param-unique", `${ROUTES}/twice/headers/x-a`],
    ["union-header", `${ROUTES}/hook/headers/X-GitHub-Event`],
    ["redirect-body", `${ROUTES}/moved/responses/301/body`],
    ["route-unique", `${ROUTES}/twice`],
    ["id-property", `${ROUTES}/notes/id/noteId`],
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

test("opaque outside parameters: no file, nor a list of opaque values or files, in a parameter or a header", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
surfaces:
  app:
    prefix: /v{version}
    routes:
      hook:
        method: get
        path: 'raw/{raw}'
        pathParams: { raw: { file: {} } }
        query: { payloads: { type: array, items: { opaque: "Vendor JSON." } } }
        headers: { X-Files: { type: array, items: { file: {} } } }
        responses:
          200: { headers: { X-Trace: { type: array, items: { opaque: "Vendor JSON." } } } }
`);
  const hook = `${ROUTES}/hook`;
  const file: IrWriter.TypeUse = { kind: "file", media: [] };
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${hook}/pathParams/raw`]: file,
      [`${hook}/query/payloads`]: { kind: "array", items: opaque },
      [`${hook}/headers/X-Files`]: { kind: "array", items: file },
      [`${hook}/responses/200/headers/X-Trace`]: { kind: "array", items: opaque },
    },
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(draft.operations[0]?.params).toEqual({ path: [], query: [], header: [] });
  expect(draft.operations[0]?.responses?.[0]?.headers).toEqual([]);
  expect(diagnostics.map(({ origin, message }) => ({ origin, message }))).toEqual([
    {
      origin: at(`${hook}/headers/X-Files`),
      message: "The request header X-Files of hook is a file, which has no text form.",
    },
    {
      origin: at(`${hook}/pathParams/raw`),
      message: "The path parameter raw of hook is a file, which has no text form.",
    },
    {
      origin: at(`${hook}/query/payloads`),
      message: "The query field payloads of hook is an opaque value, which has no text form.",
    },
    {
      origin: at(`${hook}/responses/200/headers/X-Trace`),
      message: "The response header X-Trace of hook is an opaque value, which has no text form.",
    },
  ]);
});

test("a collection id written as a schema name gives its one property as the member id", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  TaskKey: { type: object, properties: { taskId: { type: string } } }
  Task: { type: object, properties: { taskId: { type: string } } }
  Note: { type: object, properties: { text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks:
        kind: collection
        id: TaskKey
        item: Task
        ops: [get]
      notes: { kind: collection, id: TaskKey, singular: note, item: Note, ops: [get] }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${TASKS}/id`]: ref("TaskKey"),
      [`${TASKS}/item`]: ref("Task"),
      [`${ROUTES}/notes/id`]: ref("TaskKey"),
      [`${ROUTES}/notes/item`]: ref("Note"),
    },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("TaskKey", "/schemas/TaskKey", { taskId: text }),
    treeNodesObjectSchema("Task", "/schemas/Task", { taskId: text }),
    treeNodesObjectSchema("Note", "/schemas/Note", { text }),
  );
  const raw = treeNodesApiOf(workspace);
  const { diagnostics } = treeNodesRun(raw, workspace, { treeSchemas, draft });

  // The item without the id property is located at the schema name `id` writes.
  expect(diagnostics.map(({ rule, origin }) => ({ rule, origin }))).toEqual([
    { rule: "seampact/tree/id-property", origin: at(`${ROUTES}/notes/id`) },
  ]);
  const get = operation(draft.operations, "getTask");

  expect(get.path).toBe("/v1/tasks/{taskId}");
  expect(get.resource).toEqual({ type: "tasks", idParam: "taskId", idProperty: "taskId" });
  expect(get.params?.path.map(({ name, origin }) => ({ name, origin }))).toEqual([
    { name: "taskId", origin: at("/schemas/TaskKey/properties/taskId") },
  ]);
});

test("an op's own item is its response body, without the owner's", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${TREE_NODES_CURSOR_PAGING}
schemas:
  Note: { type: object, properties: { text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes: { kind: collection, ops: { list: { item: Note } } }
`);
  const notes = `${ROUTES}/notes`;
  const treeSchemas = treeNodesStubService({
    typeUses: { [`${notes}/ops/list/item`]: ref("Note") },
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(diagnostics).toEqual([]);
  expect(operation(draft.operations, "listNotes").responses).toEqual([
    {
      status: 200,
      media: "application/json",
      body: ref("Note"),
      shape: "page",
      headers: [],
      origin: at(`${notes}/ops/list/item`),
      ...viaFormat({ layer: "core", pointer: "/formats/bare" }),
    },
  ]);
});

test("paths: placeholders reported where written, once, and a placeholder only once per path", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Key: { type: string }
surfaces:
  app:
    prefix: /v{version}
    routes:
      orgs:
        kind: single
        path: 'orgs/{orgId}'
        routes:
          show: { method: get }
          audit: { method: get }
          pair: { method: get, path: 'pair/{key}/{key}', pathParams: { key: Key } }
`);
  const orgs = `${ROUTES}/orgs`;
  const treeSchemas = treeNodesStubService({
    typeUses: { [`${orgs}/routes/pair/pathParams/key`]: text },
  });
  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas });

  expect(diagnostics.map(({ rule, origin, message }) => ({ rule, origin, message }))).toEqual([
    {
      rule: "seampact/tree/path-param",
      origin: at(`${orgs}/path`),
      message:
        "The path /v1/orgs/{orgId}/show of showOrgs holds {orgId}, which no pathParams or id declares.",
    },
    {
      rule: "seampact/tree/path-param",
      origin: at(`${orgs}/routes/pair/path`),
      message:
        "The path /v1/orgs/{orgId}/pair/{key}/{key} of pairOrgs holds {key} twice, so one parameter would fill two segments.",
    },
  ]);
});

test("paths: a written path is relative segments, reported once where written", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
conventions:
  ops: { batch: { path: 'lookup?all' } }
schemas:
  Id: { type: string }
  Task: { type: object, properties: { taskId: Id } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks:
        kind: collection
        id: { taskId: Id }
        item: Task
        ops: { get: { path: '../peek' }, batch: {} }
      rooted: { method: get, path: /rooted }
      gaps: { method: get, path: 'a//b' }
      escaped: { method: get, path: '%2e%2e' }
      fine: { method: get, path: 'a/b' }
`);
  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas: treeNodesStubService({}),
  });

  expect(diagnostics.map(({ rule, origin, message }) => ({ rule, origin, message }))).toEqual([
    {
      rule: "seampact/tree/path-segment",
      origin: at("/conventions/ops/batch/path"),
      message:
        "The path lookup?all written for getTasksBatch holds ?, # or %; a path is relative segments.",
    },
    {
      rule: "seampact/tree/path-segment",
      origin: at(`${TASKS}/ops/get/path`),
      message:
        "The path ../peek written for getTask holds a . or .. segment; a path is relative segments.",
    },
    {
      rule: "seampact/tree/path-segment",
      origin: at(`${ROUTES}/rooted/path`),
      message: "The path /rooted written for rooted starts with /; a path is relative segments.",
    },
    {
      rule: "seampact/tree/path-segment",
      origin: at(`${ROUTES}/gaps/path`),
      message:
        "The path a//b written for gaps holds an empty segment; a path is relative segments.",
    },
    {
      rule: "seampact/tree/path-segment",
      origin: at(`${ROUTES}/escaped/path`),
      message: "The path %2e%2e written for escaped holds ?, # or %; a path is relative segments.",
    },
  ]);
});

test("declared params: a query field named like a path parameter, and one with no query encoding", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Id: { type: string }
surfaces:
  app:
    prefix: /v{version}
    routes:
      show:
        method: get
        path: 'items/{itemId}'
        pathParams: { itemId: Id }
        query: { itemId?: { type: string }, tags?: { type: array, items: { type: string } } }
`);
  const show = `${ROUTES}/show`;
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${show}/pathParams/itemId`]: text,
      [`${show}/query/itemId?`]: text,
      [`${show}/query/tags?`]: { kind: "array", items: text },
    },
    queryWires: { [`${show}/query/itemId?`]: wire("text") },
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(draft.operations[0]?.params?.query.map(({ name }) => name)).toEqual(["itemId"]);
  expect(
    diagnostics.map(({ rule, origin, message, related }) => ({ rule, origin, message, related })),
  ).toEqual([
    {
      rule: "seampact/tree/param-unique",
      origin: at(`${show}/query/itemId?`),
      message:
        "The query field itemId of show has the name of its path parameter, which frameworks merging both read as one value.",
      related: [{ origin: at(`${show}/pathParams/itemId`), message: "the path parameter" }],
    },
    {
      rule: "seampact/tree/query-field",
      origin: at(`${show}/query/tags?`),
      message: "The query field tags of show has no query encoding.",
      related: [],
    },
  ]);
});

test("declared responses: refused beside output, a 204 body, a header twice; a description kept as docs", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Note: { type: object, properties: { text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      both: { method: get, output: Note, responses: { 200: { body: Note } } }
      empty: { method: post, responses: { 204: { body: Note } } }
      told: { method: get, responses: { 202: { description: Accepted for later. } } }
      twice:
        method: get
        responses: { 202: { headers: { Retry-After: { type: string }, retry-after: { type: string } } } }
`);
  const twice = `${ROUTES}/twice/responses/202/headers`;
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/both/output`]: ref("Note"),
      [`${ROUTES}/both/responses/200/body`]: ref("Note"),
      [`${ROUTES}/empty/responses/204/body`]: ref("Note"),
      [`${twice}/Retry-After`]: text,
      [`${twice}/retry-after`]: text,
    },
  });
  const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas,
  });

  expect(
    operation(draft.operations, "twice").responses?.[0]?.headers.map(({ name }) => name),
  ).toEqual(["Retry-After"]);
  expect(operation(draft.operations, "told").responses?.[0]?.docs).toEqual({
    description: "Accepted for later.",
  });
  expect(
    diagnostics.map(({ rule, origin, message, related }) => ({ rule, origin, message, related })),
  ).toEqual([
    {
      rule: "seampact/tree/responses-output",
      origin: at(`${ROUTES}/both/output`),
      message: "The route both writes both responses and output; responses replaces output.",
      related: [],
    },
    {
      rule: "seampact/tree/no-content-body",
      origin: at(`${ROUTES}/empty/responses/204`),
      message: "The 204 response of empty has a body, which a 204 No Content never carries.",
      related: [],
    },
    {
      rule: "seampact/tree/param-unique",
      origin: at(`${twice}/retry-after`),
      message: "The response header retry-after of twice is declared twice.",
      related: [{ origin: at(`${twice}/Retry-After`), message: "the first declaration" }],
    },
  ]);
});

test("declared responses: an op's output takes its status, a delete with a body answers 200 unless its status is set", () => {
  const contract = (conventions: string) => `
api: { name: a, version: 1, kind: product }
${conventions}
schemas:
  Id: { type: string }
  Task: { type: object, properties: { taskId: Id } }
  NewTask: { type: object, properties: { title: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks:
        kind: collection
        id: { taskId: Id }
        item: Task
        ops: { create: { input: NewTask, output: Task }, delete: { output: Task } }
        member:
          routes:
            archive: { method: post, responses: { 200: { body: { file: {} } } } }
      logs:
        kind: collection
        member:
          routes:
            pin: { method: post }
            unpin: { method: post }
`;
  const file: IrWriter.TypeUse = { kind: "file", media: [] };
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${TASKS}/id/taskId`]: text,
      [`${TASKS}/item`]: ref("Task"),
      [`${TASKS}/ops/create/input`]: ref("NewTask"),
      [`${TASKS}/ops/create/output`]: ref("Task"),
      [`${TASKS}/ops/delete/output`]: ref("Task"),
      [`${TASKS}/member/routes/archive/responses/200/body`]: file,
    },
  });
  const statusesOf = (conventions: string) => {
    const workspace = treeNodesLoadInline(contract(conventions));
    const { draft, diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
      treeSchemas,
      draft: treeNodesDraftWith(
        treeNodesObjectSchema("NewTask", "/schemas/NewTask", { title: text }),
      ),
    });

    return {
      operations: draft.operations.map(({ id, responses }) => ({
        id,
        responses: responses?.map(({ status, shape, media }) => ({ status, shape, media })),
      })),
      diagnostics: diagnostics.map(({ rule, origin }) => ({ rule, origin })),
    };
  };

  const json = "application/json";
  const archive = {
    id: "archiveTask",
    responses: [{ status: 200, shape: "binary", media: undefined }],
  };
  const idless = [{ rule: "seampact/tree/collection-id", origin: at(`${ROUTES}/logs`) }];

  expect(statusesOf("")).toEqual({
    operations: [
      { id: "createTask", responses: [{ status: 201, shape: "item", media: json }] },
      { id: "deleteTask", responses: [{ status: 200, shape: "item", media: json }] },
      archive,
    ],
    diagnostics: idless,
  });
  expect(statusesOf("conventions: { ops: { delete: { status: 202 } } }")).toEqual({
    operations: [
      { id: "createTask", responses: [{ status: 201, shape: "item", media: json }] },
      { id: "deleteTask", responses: [{ status: 202, shape: "item", media: json }] },
      archive,
    ],
    diagnostics: idless,
  });
});

test("a collection id naming a non-object schema is refused once, without a route clash", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${TREE_NODES_CURSOR_PAGING}
schemas:
  Missing: { type: string }
  Task: { type: object, properties: { taskId: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks: { kind: collection, id: Missing, singular: task, item: Task, ops: [get, list] }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${TASKS}/id`]: ref("Missing"),
      [`${TASKS}/item`]: ref("Task"),
    },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("Task", "/schemas/Task", { taskId: text }),
  );
  const raw = treeNodesApiOf(workspace);
  const { diagnostics } = treeNodesRun(raw, workspace, { treeSchemas, draft });

  expect(
    diagnostics.map(({ rule, origin }) => [rule.replace("seampact/tree/", ""), origin.pointer]),
  ).toEqual([["fields-schema", `${TASKS}/id`]]);
});

test("get without a body: an input on a get is refused where it is written", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
surfaces:
  app:
    prefix: /v{version}
    routes:
      search: { method: get, input: { type: object, properties: { q: { type: string } } } }
      find: { method: post, input: { type: object, properties: { q: { type: string } } } }
`);
  const { diagnostics } = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas: treeNodesStubService({}),
  });

  expect(diagnostics.map(({ rule, origin, message }) => [rule, origin.pointer, message])).toEqual([
    [
      "seampact/tree/get-input",
      `${ROUTES}/search/input`,
      "The get route search declares an input, but a get request carries no body.",
    ],
  ]);
});

test("query defaults: an optional query field keeps its written default, inline or from its schema property", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Filter: { type: object, properties: { state: { type: string, default: open } }, required: [] }
surfaces:
  app:
    prefix: /v{version}
    routes:
      inline: { method: get, query: { "size?": { type: integer, default: 20 }, "q?": { type: string }, page: { type: integer, default: 1 } } }
      named: { method: get, query: Filter }
`);
  const filter = treeNodesObjectSchema("Filter", "/schemas/Filter", { state: text });
  const draft = treeNodesDraftWith({
    ...filter,
    properties: filter.properties.map((state) => ({ ...state, optional: true, default: "open" })),
  });
  const inline = (field: string) => `${ROUTES}/inline/query/${field}`;
  const treeSchemas = treeNodesStrictStubService({
    typeUses: {
      [`${ROUTES}/named/query`]: ref("Filter"),
      [inline("size?")]: integer,
      [inline("q?")]: text,
      [inline("page")]: integer,
    },
    queryWires: {
      "/schemas/Filter/properties/state": wire("text"),
      [inline("size?")]: wire("number"),
      [inline("q?")]: wire("text"),
      [inline("page")]: wire("number"),
    },
  });
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });
  const defaults = (id: string) =>
    operation(run.draft.operations, id).params?.query.map((param) => [param.name, param.default]);

  expect(run.diagnostics).toEqual([]);
  // A required field writes no default: a client always sends it.
  expect(defaults("inline")).toEqual([
    ["size", 20],
    ["q", undefined],
    ["page", undefined],
  ]);
  expect(defaults("named")).toEqual([["state", "open"]]);
});
