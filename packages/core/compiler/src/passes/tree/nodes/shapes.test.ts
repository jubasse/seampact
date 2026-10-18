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
  treeNodesRunAfterSchemas,
  treeNodesStubService,
  treeNodesUnansweredAt,
} from "./test-support.js";

// The shape of each operation beyond its route (ADR 0002 sections 6, 10, 12 and 14): write semantics, paging,
// batch reads, degradable parts and budgets, lifecycle members, docs, extensions and route examples.

const ROUTES = "/surfaces/app/routes";
const text: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };
const integer: IrWriter.TypeUse = { kind: "scalar", type: "integer", refinements: {} };
const ref = (schema: string): IrWriter.TypeUse => ({ kind: "ref", schema });
const at = (pointer: string, layer: IrWriter.Origin["layer"] = "api"): IrWriter.Origin => ({
  layer,
  pointer,
});

const operation = (operations: readonly DraftOperation[], id: string): DraftOperation => {
  const found = operations.find((candidate) => candidate.id === id);

  if (found === undefined) throw new Error(`no operation ${id}`);

  return found;
};

// An object schema whose properties named in `optional` are optional.
function objectSchema(
  id: string,
  properties: Record<string, IrWriter.TypeUse>,
  optional: readonly string[] = [],
): IrWriter.ObjectSchema {
  const schema = treeNodesObjectSchema(id, `/schemas/${id}`, properties);

  for (const property of schema.properties) property.optional = optional.includes(property.name);

  return schema;
}

const CURSOR = `
pagings:
  cursor:
    request: { cursor: { query: cursor }, limit: { query: limit }, sort: { query: sort, style: signed } }
    response: { body: $items }
  changes:
    request: { since: { query: since } }
    response: { body: { items: $items, next: $nextSince } }
`;

test("write semantics: owner, concurrency inherited by update and delete, a member route opting in", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Id: { type: string }
  Task: { type: object, properties: { taskId: Id, version: { type: integer } } }
  UpdateTask: { type: object, properties: { title: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks:
        kind: collection
        id: { taskId: Id }
        item: Task
        concurrency: { version: body.expectedVersion, field: version }
        ops: { get: {}, update: { input: UpdateTask }, delete: {} }
        member:
          routes:
            archive: { method: post, concurrency: inherit, input: UpdateTask, output: Task }
            touch: { method: post, output: Task }
      files:
        kind: collection
        id: { fileId: Id }
        idProperty: taskId
        item: Task
        concurrency: { version: header.If-Match, field: version }
        ops: { delete: {} }
      me:
        kind: single
        owner: caller
        item: Task
        ops: { get: {}, update: { input: UpdateTask } }
      settings:
        kind: single
        item: Task
        concurrency: { version: body.expectedVersion, field: version }
        routes:
          reset: { method: post, concurrency: inherit, input: UpdateTask, output: Task }
      drafts:
        kind: collection
        id: { draftId: Id }
        idProperty: taskId
        owner: caller
        item: Task
        member:
          routes:
            publish: { method: post, output: Task }
`);
  const tasks = `${ROUTES}/tasks`;
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${tasks}/id/taskId`]: text,
      [`${tasks}/item`]: ref("Task"),
      [`${tasks}/ops/update/input`]: ref("UpdateTask"),
      [`${tasks}/member/routes/archive/input`]: ref("UpdateTask"),
      [`${tasks}/member/routes/archive/output`]: ref("Task"),
      [`${tasks}/member/routes/touch/output`]: ref("Task"),
      [`${ROUTES}/files/id/fileId`]: text,
      [`${ROUTES}/files/item`]: ref("Task"),
      [`${ROUTES}/me/item`]: ref("Task"),
      [`${ROUTES}/me/ops/update/input`]: ref("UpdateTask"),
      [`${ROUTES}/settings/item`]: ref("Task"),
      [`${ROUTES}/settings/routes/reset/input`]: ref("UpdateTask"),
      [`${ROUTES}/settings/routes/reset/output`]: ref("Task"),
      [`${ROUTES}/drafts/id/draftId`]: text,
      [`${ROUTES}/drafts/item`]: ref("Task"),
      [`${ROUTES}/drafts/member/routes/publish/output`]: ref("Task"),
    },
  });
  const draft = treeNodesDraftWith(
    objectSchema("Task", { taskId: text, version: integer }),
    objectSchema("UpdateTask", { title: text }),
  );
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });

  const shapeOf = (id: string) => {
    const { concurrency, owner } = operation(run.draft.operations, id);

    return { concurrency, owner };
  };

  const body = { version: { in: "body", name: "expectedVersion" }, field: "version" };

  expect(run.diagnostics).toEqual([]);
  expect(shapeOf("getTask")).toEqual({ concurrency: undefined, owner: undefined });
  expect(shapeOf("updateTask")).toEqual({ concurrency: body, owner: undefined });
  // A delete without input reads a body version from the query (A33).
  expect(shapeOf("deleteTask").concurrency).toEqual({
    version: { in: "query", name: "expectedVersion" },
    field: "version",
  });
  expect(shapeOf("archiveTask").concurrency).toEqual(body);
  expect(shapeOf("touchTask").concurrency).toBeUndefined();
  expect(shapeOf("deleteFile").concurrency).toEqual({
    version: { in: "header", name: "If-Match" },
    field: "version",
  });
  expect(shapeOf("updateMe")).toEqual({
    concurrency: undefined,
    owner: { kind: "caller", origin: at(`${ROUTES}/me/owner`) },
  });
  expect(shapeOf("getMe").owner).toEqual({ kind: "caller", origin: at(`${ROUTES}/me/owner`) });
  // A single's own routes take its version; a member route of a caller-owned collection is caller-owned too.
  expect(shapeOf("resetSettings").concurrency).toEqual(body);
  expect(shapeOf("publishDraft").owner).toEqual({
    kind: "caller",
    origin: at(`${ROUTES}/drafts/owner`),
  });
});

test("paging declared: the route's style or none, else the convention's, with limits, token and sort keys", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${CURSOR}
conventions:
  paging: { default: cursor, maxLimit: 100, overLimit: clamp }
schemas:
  Note: { type: object, properties: { createdAt: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes: { method: get, item: Note, sortable: [createdAt, { key: createdAt, right: notes.read }] }
      recent: { method: get, item: Note, paging: { cursor: { maxLimit: 20, overLimit: reject } } }
      sized: { method: get, item: Note, paging: { cursor: { defaultLimit: 10 } } }
      everything: { method: get, item: Note, paging: none }
      changes: { method: get, item: Note, paging: changes }
      instants: { method: get, item: Note, paging: { changes: { token: instant } } }
`);
  const item = (route: string) => [`${ROUTES}/${route}/item`, ref("Note")] as const;
  const routes = ["notes", "recent", "sized", "everything", "changes", "instants"];
  const treeSchemas = treeNodesStubService({ typeUses: Object.fromEntries(routes.map(item)) });
  const draft = treeNodesDraftWith(objectSchema("Note", { createdAt: text }));
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });
  const paging = (id: string) => operation(run.draft.operations, id).paging;
  const convention = at("/conventions/paging/default");

  expect(run.diagnostics).toEqual([]);
  expect(paging("notes")).toEqual({
    style: "cursor",
    maxLimit: 100,
    defaultLimit: 100,
    overLimit: "clamp",
    sortKeys: [
      { key: "createdAt", origin: at(`${ROUTES}/notes/sortable/0`) },
      { key: "createdAt", origin: at(`${ROUTES}/notes/sortable/1`) },
    ],
    origin: convention,
  });
  expect(paging("recent")).toEqual({
    style: "cursor",
    maxLimit: 20,
    defaultLimit: 20,
    overLimit: "reject",
    sortKeys: [],
    origin: at(`${ROUTES}/recent/paging`),
  });
  expect(paging("sized")).toMatchObject({ maxLimit: 100, defaultLimit: 10 });
  expect(paging("everything")).toEqual({
    overLimit: "clamp",
    sortKeys: [],
    origin: at(`${ROUTES}/everything/paging`),
  });
  expect(paging("changes")).toMatchObject({ style: "changes", token: "opaque", defaultLimit: 100 });
  expect(paging("instants")).toMatchObject({ style: "changes", token: "instant" });
  expect(operation(run.draft.operations, "everything").responses?.[0]?.shape).toBe("list");
});

test("paging declared: a list with neither a style nor a default names both fixes", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Note: { type: object, properties: { text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes: { method: get, item: Note }
`);
  const treeSchemas = treeNodesStubService({ typeUses: { [`${ROUTES}/notes/item`]: ref("Note") } });
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas });

  expect(run.diagnostics.map(({ rule, fix }) => ({ rule, fix }))).toEqual([
    {
      rule: "seampact/tree/paging-style",
      fix: "Declare a style in pagings and name it in paging (or conventions.paging.default), or apply a format pack that provides one; paging: none serves the whole list.",
    },
  ]);
  expect(operation(run.draft.operations, "notes").paging).toBeUndefined();
});

test("batch read: a safe POST of the hoisted ids input, answered as a table, within the batch budget", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
conventions:
  batch: { maxIds: 50, budget: 150ms }
schemas:
  Id: { type: string }
  Task: { type: object, properties: { taskId: Id } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks: { kind: collection, id: { taskId: Id }, item: Task, ops: [batch] }
      notes:
        kind: collection
        id: { noteId: Id }
        item: Task
        budget: 40ms
        ops: [batch]
`);
  const batch = `${ROUTES}/tasks/ops/0`;
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/tasks/id/taskId`]: text,
      [`${ROUTES}/tasks/item`]: ref("Task"),
      [batch]: ref("GetTasksBatchInput"),
      [`${ROUTES}/notes/id/noteId`]: text,
      [`${ROUTES}/notes/item`]: ref("Task"),
    },
  });
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas });
  const getTasks = operation(run.draft.operations, "getTasksBatch");

  expect(run.diagnostics).toEqual([]);
  expect(getTasks).toMatchObject({
    method: "post",
    safe: true,
    input: { media: "application/json", schema: ref("GetTasksBatchInput"), origin: at(batch) },
    responses: [
      {
        status: 200,
        media: "application/json",
        body: ref("Task"),
        shape: "table",
        headers: [],
        derivedFrom: { derivation: "batch.read", from: [at(batch)] },
      },
    ],
    budgetMs: 150,
  });
  expect(getTasks.responses?.[0]?.origin).toBeUndefined();
  // A written budget wins over the batch default.
  expect(operation(run.draft.operations, "getNotesBatch").budgetMs).toBe(40);
});

test("degradable and budget: optional paths, the degraded header or the format's degraded field", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
formats:
  house:
    success: { item: { body: { data: $payload, meta: $meta } } }
    meta: { degraded: { fill: degraded } }
conventions:
  degradedHeader: X-Degraded
schemas:
  Profile: { type: object, properties: { stats: { type: object } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      profile: { method: get, output: Profile, degradable: [stats.views], budget: 300ms }
      wrapped: { method: get, output: Profile, format: house, degradable: [stats] }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/profile/output`]: ref("Profile"),
      [`${ROUTES}/wrapped/output`]: ref("Profile"),
    },
  });
  const draft = treeNodesDraftWith(
    objectSchema("Profile", { stats: ref("Stats") }, ["stats"]),
    objectSchema("Stats", { views: integer }, ["views"]),
  );
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });
  const profile = operation(run.draft.operations, "profile");

  expect(run.diagnostics).toEqual([]);
  expect(profile.degradable).toEqual({
    paths: ["stats.views"],
    origin: at(`${ROUTES}/profile/degradable`),
  });
  expect(profile.budgetMs).toBe(300);
  expect(operation(run.draft.operations, "wrapped").responses?.[0]?.derivedFrom).toEqual({
    derivation: "response.format",
    from: [at("/formats/house")],
  });
});

test("lifecycle members: deprecated, upstream, stated maturity, internal, tags, docs and extensions", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product, x-acme-team: core }
services:
  catalog: { maturity: stable }
  ledger: { maturity: provisional }
surfaces:
  app:
    prefix: /v{version}
    tags: [shop]
    upstream: [catalog]
    x-acme-team: shop
    routes:
      orders:
        kind: single
        tags: [orders, shop]
        internal: true
        maturity: { level: experimental, reason: "New checkout." }
        deprecated: { since: '2026-12-31', sunset: '2027-06-30' }
        x-acme-tier: gold
        routes:
          list: { method: get, output: { type: string }, summary: Orders., description: All orders. }
          old:
            method: get
            output: { type: string }
            upstream: [ledger, catalog]
            maturity: stable
            internal: false
            deprecated: { since: '2027-01-01', sunset: '2027-01-01', successor: listOrders }
      ping: { method: get, output: { type: string } }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: Object.fromEntries(
      ["orders/routes/list", "orders/routes/old", "ping"].map((route) => [
        `${ROUTES}/${route}/output`,
        text,
      ]),
    ),
  });
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas });
  const lifecycle = (id: string) => {
    const { deprecated, upstream, maturity, internal, tags, docs, extensions } = operation(
      run.draft.operations,
      id,
    );

    return { deprecated, upstream, maturity, internal, tags, docs, extensions };
  };

  const orders = `${ROUTES}/orders`;

  expect(run.diagnostics).toEqual([]);
  expect(run.draft.api?.extensions).toEqual({ acme: { team: "core" } });
  expect(lifecycle("listOrders")).toEqual({
    deprecated: {
      since: "2026-12-31",
      sunset: "2027-06-30",
      origin: at(`${orders}/deprecated`),
    },
    upstream: ["catalog"],
    maturity: {
      level: "experimental",
      source: "stated",
      reason: "New checkout.",
      origin: at(`${orders}/maturity`),
    },
    internal: true,
    tags: ["shop", "orders"],
    docs: { summary: "Orders.", description: "All orders." },
    extensions: { acme: { team: "shop", tier: "gold" } },
  });
  expect(lifecycle("oldOrders")).toMatchObject({
    deprecated: {
      since: "2027-01-01",
      sunset: "2027-01-01",
      successor: { kind: "httpOperation", api: "a", id: "listOrders" },
      origin: at(`${orders}/routes/old/deprecated`),
    },
    upstream: ["ledger", "catalog"],
    maturity: { level: "stable", source: "stated", origin: at(`${orders}/routes/old/maturity`) },
    internal: false,
  });
  expect(lifecycle("ping")).toEqual({
    deprecated: undefined,
    upstream: ["catalog"],
    maturity: undefined,
    internal: false,
    tags: ["shop"],
    docs: {},
    extensions: { acme: { team: "shop" } },
  });
});

test("lifecycle members: a successor whose path params the deprecated route holds, of the same type, is accepted", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Key: { type: string }
surfaces:
  app:
    routes:
      keyed: { method: get, operationId: getKeyed, path: 'keyed/{key}', pathParams: { key: Key }, output: Key }
      old:
        method: get
        path: 'old/{key}/{extra}'
        pathParams: { key: Key, extra: Key }
        output: Key
        deprecated: { since: '2026-12-31', sunset: '2027-06-30', successor: getKeyed }
`);
  const documented: IrWriter.TypeUse = { ...text, docs: { summary: "The key." } };
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/keyed/output`]: text,
      [`${ROUTES}/old/output`]: text,
      [`${ROUTES}/keyed/pathParams/key`]: documented,
      [`${ROUTES}/old/pathParams/key`]: text,
      [`${ROUTES}/old/pathParams/extra`]: text,
    },
  });
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas });

  // Docs say how a use is written, not what it accepts: they are not compared.
  expect(run.diagnostics).toEqual([]);
  expect(operation(run.draft.operations, "old").deprecated?.successor?.id).toBe("getKeyed");
});

test("lifecycle members: a service api writes no internal", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: service, caller: { identity: service, right: caller } }
surfaces:
  internal:
    prefix: /internal/v{version}
    internal: true
    routes:
      ping: { method: get, output: { type: string } }
      pong: { method: get, output: { type: string } }
`);
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, {
    treeSchemas: treeNodesStubService({}),
  });

  expect(run.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/internal-product", "/surfaces/internal/internal"],
  ]);
});

test("route examples: request and success values checked against what the handler returns, table keys by the id, errors unchecked", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${CURSOR}
conventions:
  paging: { default: cursor, maxLimit: 50 }
  batch: { maxIds: 20 }
schemas:
  Id: { type: string }
  Note: { type: object, properties: { noteId: Id, text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes:
        kind: collection
        id: { noteId: Id }
        item: Note
        ops:
          list:
            examples:
              page: { status: 200, value: [{ noteId: n1, text: invalid }] }
          create:
            input: Note
            examples:
              minimal: { request: true, value: { text: invalid } }
              created: { status: 201, value: { noteId: n1, text: Hello } }
              refused: { error: api.schema_invalid, value: { issues: invalid } }
          batch:
            examples:
              table:
                status: 200
                value: { n1: { noteId: n1, text: invalid }, invalid: { noteId: n2, text: Hi } }
`);
  const notes = `${ROUTES}/notes`;
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${notes}/id/noteId`]: text,
      [`${notes}/item`]: ref("Note"),
      [`${notes}/ops/create/input`]: ref("Note"),
    },
  });
  const draft = treeNodesDraftWith(
    treeNodesObjectSchema("Note", "/schemas/Note", { noteId: text, text }),
  );
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });

  expect(run.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/example-value", `${notes}/ops/list/examples/page/value/0/text`],
    ["seampact/tree/example-value", `${notes}/ops/create/examples/minimal/value/text`],
    ["seampact/tree/example-value", `${notes}/ops/batch/examples/table/value/n1/text`],
    ["seampact/tree/example-value", `${notes}/ops/batch/examples/table/value/invalid`],
  ]);
  // A table key is read by the collection's id schema in its text form.
  expect(run.diagnostics[3]?.message).toBe(
    "The example table of getNotesBatch has the key 'invalid', which does not read as the id: the value is invalid.",
  );
  expect(run.diagnostics[0]?.message).toBe(
    "The example page of listNotes does not fit its schema at '/0/text': the value is invalid.",
  );
  expect(operation(run.draft.operations, "createNote").examples).toEqual({
    minimal: { request: true, value: { text: "invalid" } },
    created: { status: 201, value: { noteId: "n1", text: "Hello" } },
    refused: { error: "api.schema_invalid", value: { issues: "invalid" } },
  });
});

// Both id forms of a collection, compiled by the real tree.schemas: a fields map and the name of an object schema.
test.each([
  ["a fields map", "id: { noteId: { type: integer } }"],
  ["a schema name", "id: NoteKey"],
])(
  "table example keys: an id written as %s reads each key by its one property type",
  (_form, id) => {
    const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${CURSOR}
conventions:
  batch: { maxIds: 20 }
schemas:
  NoteKey: { type: object, properties: { noteId: { type: integer } } }
  Note: { type: object, properties: { noteId: { type: integer }, text: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes:
        kind: collection
        ${id}
        item: Note
        ops:
          batch:
            examples:
              table: { status: 200, value: { "1": { noteId: 1, text: a }, "${"k".repeat(100)}": { noteId: 2, text: b } } }
`);
    const run = treeNodesRunAfterSchemas(workspace);
    const notes = `${ROUTES}/notes`;

    expect(run.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
      ["seampact/tree/example-value", `${notes}/ops/batch/examples/table/value/${"k".repeat(100)}`],
    ]);
    // The quoted key is cut, since a key is free author text.
    expect(run.diagnostics[0]?.message).toMatch(
      new RegExp(
        `^The example table of getNotesBatch has the key '${"k".repeat(80)}…', which does not read as the id: `,
      ),
    );
  },
);

// One refusal of each shape rule, each diagnostic located in the locations table, with a sentence and a fix.
test("tree.nodes diagnostics are located: shapes", () => {
  const workspace = treeNodesLoadDirectory(`${TREE_NODES_FIXTURES}shapes-refused/`);
  const raw = treeNodesApiOf(workspace);
  const uses: Record<string, IrWriter.TypeUse> = {
    [`${ROUTES}/drafts/id/noteId`]: text,
    [`${ROUTES}/drafts/item`]: ref("Note"),
    [`${ROUTES}/drafts/ops/update/input`]: ref("NewNote"),
    [`${ROUTES}/notes/id/noteId`]: text,
    [`${ROUTES}/notes/item`]: ref("Note"),
    [`${ROUTES}/tags/id/noteId`]: text,
    [`${ROUTES}/tags/item`]: ref("Note"),
    [`${ROUTES}/queried/query/cursor?`]: text,
  };

  for (const route of ["pages", "unpaged", "limited", "searched", "queried"])
    uses[`${ROUTES}/${route}/item`] = ref("Note");

  for (const route of [
    "partial",
    "wrapped",
    "late",
    "unreal",
    "leapless",
    "legacy/routes/first",
    "legacy/routes/second",
    "keyed",
    "unkeyed",
    "rekeyed",
  ])
    uses[`${ROUTES}/${route}/output`] = ref("Note");

  uses[`${ROUTES}/keyed/pathParams/key`] = text;
  uses[`${ROUTES}/rekeyed/pathParams/key`] = integer;
  const treeSchemas = treeNodesStubService({
    typeUses: uses,
    queryWires: {
      [`${ROUTES}/queried/query/cursor?`]: {
        kind: "text",
        style: "form",
        explode: true,
        brackets: false,
      },
    },
  });
  const draft = treeNodesDraftWith(
    objectSchema("Note", { noteId: text, text, extra: text }, ["extra"]),
    objectSchema("NewNote", { text, expectedVersion: integer }),
  );
  const { diagnostics } = treeNodesRun(raw, workspace, { treeSchemas, draft });

  // Every rule once at least, each at the pointer that writes the refused value.
  expect(
    diagnostics.map(({ rule, origin }) => [rule.replace("seampact/tree/", ""), origin.pointer]),
  ).toEqual([
    ["owner-concurrency", `${ROUTES}/drafts/concurrency`],
    ["concurrency-input", "/schemas/NewNote/properties/expectedVersion"],
    ["paging-token", `${ROUTES}/notes/ops/list/paging`],
    ["sort-key", `${ROUTES}/tags/ops/list/sortable/0`],
    ["paging-list", `${ROUTES}/tags/ops/get/paging`],
    ["concurrency-inherit", `${ROUTES}/tags/member/routes/flag/concurrency`],
    ["paging-unknown", `${ROUTES}/pages/paging`],
    ["paging-style", `${ROUTES}/unpaged`],
    ["paging-limit", `${ROUTES}/limited/paging`],
    ["paging-sort", `${ROUTES}/searched/sortable`],
    ["paging-param", `${ROUTES}/queried/query/cursor?`],
    ["degradable-path", `${ROUTES}/partial/degradable/0`],
    ["degradable-path", `${ROUTES}/partial/degradable/1`],
    ["degradable-header", `${ROUTES}/partial/degradable`],
    ["budget-duration", `${ROUTES}/partial/budget`],
    ["deprecated-sunset", `${ROUTES}/partial/deprecated`],
    ["upstream-service", `${ROUTES}/partial/upstream/1`],
    ["format-unknown", `${ROUTES}/wrapped/format`],
    ["example-target", `${ROUTES}/wrapped/examples/bare`],
    ["example-value", `${ROUTES}/wrapped/examples/wrong/value/text`],
    ["deprecated-since", `${ROUTES}/late/deprecated/since`],
    ["deprecated-since", `${ROUTES}/unreal/deprecated/since`],
    ["deprecated-sunset", `${ROUTES}/leapless/deprecated/sunset`],
    // The inherited deprecation is reported once, at the node that writes it.
    ["deprecated-since", `${ROUTES}/legacy/deprecated`],
    ["deprecated-successor", `${ROUTES}/wrapped/deprecated/successor`],
    ["deprecated-successor-params", `${ROUTES}/unkeyed/deprecated/successor`],
    ["deprecated-successor-params", `${ROUTES}/rekeyed/deprecated/successor`],
  ]);
  expect(
    diagnostics
      .filter(({ rule }) => rule.endsWith("/deprecated-successor-params"))
      .map(({ message }) => message),
  ).toEqual([
    "The successor getKeyed of unkeyed has the path param key, which unkeyed has not.",
    "The successor getKeyed of rekeyed has the path param key, typed otherwise than on rekeyed.",
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

test("shape refusals: a version declared again, an inherit outside the member scope, limits and example targets", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
pagings:
  cursor:
    request: { cursor: { query: cursor }, limit: { query: limit } }
    response: { body: $items }
  pages:
    request: { page: { query: page } }
    response: { body: $items }
conventions:
  paging: { default: offsets }
  batch: { maxIds: 20 }
schemas:
  Id: { type: string }
  Task: { type: object, properties: { taskId: Id, version: { type: integer } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      tasks:
        kind: collection
        id: { taskId: Id }
        item: Task
        concurrency: { version: query.version, field: version }
        ops: { delete: { query: { version?: { type: integer } } }, list: {} }
        collection:
          routes:
            sweep: { method: post, concurrency: inherit }
      files:
        kind: collection
        id: { taskId: Id }
        item: Task
        concurrency: { version: header.If-Match, field: version }
        ops:
          update:
            input: Task
            headers: { if-match: { type: string } }
            examples:
              asked: { request: true, value: {} }
              none: { status: 204, value: {} }
          batch:
            examples:
              listed: { status: 200, value: [] }
      cursors: { method: get, item: Task, paging: cursor }
      pages: { method: get, item: Task, paging: pages, sortable: [taskId] }
      pinged: { method: post, examples: { asked: { request: true, value: {} } } }
`);
  const uses: Record<string, IrWriter.TypeUse> = {
    [`${ROUTES}/tasks/id/taskId`]: text,
    [`${ROUTES}/tasks/item`]: ref("Task"),
    [`${ROUTES}/tasks/ops/delete/query/version?`]: integer,
    [`${ROUTES}/files/id/taskId`]: text,
    [`${ROUTES}/files/item`]: ref("Task"),
    [`${ROUTES}/files/ops/update/headers/if-match`]: text,
    [`${ROUTES}/files/ops/update/input`]: ref("Task"),
    [`${ROUTES}/cursors/item`]: ref("Task"),
    [`${ROUTES}/pages/item`]: ref("Task"),
  };
  const treeSchemas = treeNodesStubService({
    typeUses: uses,
    queryWires: {
      [`${ROUTES}/tasks/ops/delete/query/version?`]: {
        kind: "number",
        style: "form",
        explode: true,
        brackets: false,
      },
    },
  });
  const draft = treeNodesDraftWith(objectSchema("Task", { taskId: text, version: integer }));
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });

  expect(
    run.diagnostics.map(({ rule, origin }) => [rule.replace("seampact/tree/", ""), origin.pointer]),
  ).toEqual([
    ["paging-unknown", "/conventions/paging/default"],
    ["concurrency-inherit", `${ROUTES}/tasks/collection/routes/sweep/concurrency`],
    ["concurrency-input", `${ROUTES}/tasks/ops/delete/query/version?`],
    ["example-value", `${ROUTES}/files/ops/batch/examples/listed/value`],
    ["concurrency-input", `${ROUTES}/files/ops/update/headers/if-match`],
    ["example-target", `${ROUTES}/files/ops/update/examples/none`],
    ["paging-limit", `${ROUTES}/cursors/paging`],
    ["paging-sort", `${ROUTES}/pages/sortable`],
    ["paging-limit", `${ROUTES}/pages/paging`],
    ["example-target", `${ROUTES}/pinged/examples/asked`],
  ]);
  expect(run.diagnostics.map(({ message }) => message)).toContain(
    "The list cursors pages with cursor, but its limit role needs a maxLimit.",
  );
});

test("paging limits: a convention default is lowered to the route's maxLimit", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${CURSOR}
conventions:
  paging: { default: cursor, maxLimit: 100, defaultLimit: 50 }
schemas:
  Note: { type: object, properties: { title: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      lowered: { method: get, item: Note, paging: { cursor: { maxLimit: 20 } } }
`);
  const routes = ["lowered"];
  const treeSchemas = treeNodesStubService({
    typeUses: Object.fromEntries(routes.map((route) => [`${ROUTES}/${route}/item`, ref("Note")])),
  });
  const draft = treeNodesDraftWith(objectSchema("Note", { title: text }));
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });
  const paging = (id: string) => operation(run.draft.operations, id).paging;

  expect(run.diagnostics).toEqual([]);
  expect(paging("lowered")).toMatchObject({ maxLimit: 20, defaultLimit: 20 });
});

test("paging limits: a route default above the effective maxLimit is refused there, a convention fault once", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${CURSOR}
conventions:
  paging: { default: cursor, maxLimit: 10, defaultLimit: 50 }
schemas:
  Note: { type: object, properties: { title: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      first: { method: get, item: Note }
      second: { method: get, item: Note }
      own: { method: get, item: Note, paging: { cursor: { maxLimit: 5, defaultLimit: 8 } } }
      raised: { method: get, item: Note, paging: { cursor: { defaultLimit: 15 } } }
`);
  const routes = ["first", "second", "own", "raised"];
  const treeSchemas = treeNodesStubService({
    typeUses: Object.fromEntries(routes.map((route) => [`${ROUTES}/${route}/item`, ref("Note")])),
  });
  const draft = treeNodesDraftWith(objectSchema("Note", { title: text }));
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });

  expect(
    run.diagnostics.map(({ rule, origin, related }) => [
      rule,
      origin.pointer,
      related.map((entry) => entry.origin.pointer),
    ]),
  ).toEqual([
    [
      "seampact/tree/paging-limit",
      "/conventions/paging/defaultLimit",
      ["/conventions/paging/maxLimit"],
    ],
    ["seampact/tree/paging-limit", `${ROUTES}/own/paging`, []],
    ["seampact/tree/paging-limit", `${ROUTES}/raised/paging`, []],
  ]);
  expect(run.diagnostics[1]?.message).toBe(
    "The list own pages with cursor, but its defaultLimit 8 is above its maxLimit 5.",
  );
});

test("paging limits: a limit the convention's style lacks is reported once, at conventions.paging", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
${CURSOR}
conventions:
  paging: { default: cursor }
schemas:
  Note: { type: object, properties: { title: { type: string } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      first: { method: get, item: Note }
      second: { method: get, item: Note }
`);
  const routes = ["first", "second"];
  const treeSchemas = treeNodesStubService({
    typeUses: Object.fromEntries(routes.map((route) => [`${ROUTES}/${route}/item`, ref("Note")])),
  });
  const draft = treeNodesDraftWith(objectSchema("Note", { title: text }));
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });

  expect(run.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/paging-limit", "/conventions/paging/default"],
  ]);
});

test("write semantics: a caller-owned resource's concurrency is refused whatever its ops, its field left to tree.schemas", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
schemas:
  Id: { type: string }
  Note: { type: object, properties: { noteId: Id } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes:
        kind: collection
        id: { noteId: Id }
        item: Note
        owner: caller
        concurrency: { version: header.If-Match, field: nope }
        ops: { get: {} }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: { [`${ROUTES}/notes/id/noteId`]: text, [`${ROUTES}/notes/item`]: ref("Note") },
  });
  const draft = treeNodesDraftWith(objectSchema("Note", { noteId: text }));
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });

  expect(run.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/owner-concurrency", `${ROUTES}/notes/concurrency`],
  ]);
});

// An object schema whose one property `stats` is optional or required.
function statsHolder(id: string, optional: boolean): IrWriter.ObjectSchema {
  const holder = treeNodesObjectSchema(id, `/schemas/${id}`, { stats: text });

  return { ...holder, properties: holder.properties.map((stats) => ({ ...stats, optional })) };
}

test("degradable: a path through a union is checked in every variant, a route with no body has none", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
conventions:
  degradedHeader: X-Degraded
schemas:
  Profile: { type: object, properties: { stats: { type: object } } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      either: { method: get, output: Profile, degradable: [stats] }
      mixed: { method: get, output: Profile, degradable: [stats] }
      bodiless: { method: get, degradable: [stats] }
`);
  const treeSchemas = treeNodesStubService({
    typeUses: {
      [`${ROUTES}/either/output`]: ref("Either"),
      [`${ROUTES}/mixed/output`]: ref("Mixed"),
    },
  });
  const union = (id: string, variants: readonly string[]): IrWriter.UnionSchema => ({
    ...treeNodesHeaderUnion(id, "X-Kind"),
    variants: variants.map((schema) => ({ tag: schema.toLowerCase(), schema })),
  });
  const draft = treeNodesDraftWith(
    statsHolder("Light", true),
    statsHolder("Heavy", true),
    statsHolder("Fixed", false),
    union("Either", ["Light", "Heavy"]),
    union("Mixed", ["Light", "Fixed"]),
  );
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas, draft });

  expect(
    run.diagnostics.map(({ rule, origin, message }) => [rule, origin.pointer, message]),
  ).toEqual([
    [
      "seampact/tree/degradable-path",
      `${ROUTES}/mixed/degradable/0`,
      "The degradable path stats of mixed names a required property in the variant fixed of Mixed; only an optional part can be left out.",
    ],
    [
      "seampact/tree/degradable-path",
      `${ROUTES}/bodiless/degradable/0`,
      "The degradable path stats of bodiless names no property of the success data; only an optional part can be left out.",
    ],
  ]);
  expect(operation(run.draft.operations, "either").degradable?.paths).toEqual(["stats"]);
});

test("route examples: a status the route does not declare is named so", () => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
surfaces:
  app:
    prefix: /v{version}
    routes:
      ping: { method: get, output: { type: string }, examples: { made: { status: 201, value: x } } }
`);
  const treeSchemas = treeNodesStubService({ typeUses: { [`${ROUTES}/ping/output`]: text } });
  const run = treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas });

  expect(
    run.diagnostics.map(({ rule, origin, message }) => [rule, origin.pointer, message]),
  ).toEqual([
    [
      "seampact/tree/example-target",
      `${ROUTES}/ping/examples/made`,
      "The example made of ping targets the status 201, which the route does not declare.",
    ],
  ]);
});

// tree.schemas answers every position it accepted, and a refused one stops the run before tree.nodes.
test.each([
  ["an input", `${ROUTES}/post/input`, "input"],
  ["a batch ids input", `${ROUTES}/notes/ops/1`, "input"],
  ["an item body", `${ROUTES}/notes/item`, "output"],
  ["a written response body", `${ROUTES}/ping/responses/200/body`, "output"],
  ["a query field", `${ROUTES}/ping/query/q`, "input"],
])("an unanswered position is an internal fault: %s", (_, pointer, direction) => {
  const workspace = treeNodesLoadInline(`
api: { name: a, version: 1, kind: product }
conventions:
  batch: { maxIds: 50 }
schemas:
  Id: { type: string }
  Note: { type: object, properties: { noteId: Id } }
surfaces:
  app:
    prefix: /v{version}
    routes:
      notes: { kind: collection, id: { noteId: Id }, item: Note, ops: [list, batch], paging: none }
      ping: { method: get, query: { q: Id }, responses: { 200: { body: Note } } }
      post: { method: post, input: Note }
`);
  const treeSchemas = treeNodesUnansweredAt(treeNodesStubService({}), pointer);

  expect(() => treeNodesRun(treeNodesApiOf(workspace), workspace, { treeSchemas })).toThrow(
    `the schema service answers no ${direction} type at ${pointer}`,
  );
});
