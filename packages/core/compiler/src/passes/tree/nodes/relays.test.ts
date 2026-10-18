import { type ContractIR, IR_REVISION, type IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import { diagnosticLocationKey } from "../../../diagnostics/print.js";
import { draftFixture } from "../../../pipeline/draft-fixture.js";
import type { DraftIR, DraftOperation } from "../../../pipeline/seam.js";
import {
  treeNodesApiOf,
  treeNodesLoadInline,
  treeNodesRun,
  treeNodesStubService,
} from "./test-support.js";

const PUBLIC_API = "tasks";
const PUBLIC_ROUTES = "/surfaces/app/routes/channels/member/routes/tasks";
const ROUTES = "/surfaces/internal/routes";
const TEXT: IrWriter.TypeUse = { kind: "scalar", type: "string", refinements: {} };

const serviceApi = (routes: string, catalogues = "") => `
api:
  name: tasksService
  version: 1
  kind: service
  caller: { identity: service, right: callerService }
${catalogues}
surfaces:
  internal:
    prefix: /internal/v{version}
    routes:
${routes}`;

const ACCEPTED_ROUTES = `
      getTask: { relays: tasks.getTask }
      listTasks: { relays: tasks.listTasks }
      getTasksBatch: { relays: tasks.getTasksBatch }
      updateTask: { relays: tasks.updateTask }
      addTask: { relays: tasks.createTask, operationId: addTask }
`;

const derivedBy = (derivation: string): IrWriter.DerivedFrom => ({
  derivation,
  from: [{ layer: "api", pointer: "/surfaces/app/identity" }],
});

const declaredAt = (pointer: string): IrWriter.Origin => ({ layer: "api", pointer });

function operationOf(draft: DraftIR, id: string): DraftOperation {
  const operation = draft.operations.find((candidate) => candidate.id === id);

  if (operation === undefined) throw new Error(`the draft has no operation ${id}`);

  return operation;
}

// The public draft as the relayed api leaves it, with elements of other halves' derivations beside declared
// ones: a credential param, an ETag header, a not-modified response, sort-key rights, the input's proofs and
// the derived concurrency.
function publicDraft(): DraftIR {
  const draft = draftFixture(PUBLIC_API, "after-access");
  const getTask = operationOf(draft, "getTask");
  const response = getTask.responses?.[0];

  if (getTask.params === undefined || response === undefined)
    throw new Error("the public getTask has no params or response");

  getTask.params.header.push({
    name: "Authorization",
    type: TEXT,
    required: true,
    derivedFrom: derivedBy("identity.authenticate"),
  });
  getTask.params.query.push({
    name: "expand",
    type: TEXT,
    required: false,
    origin: declaredAt(`${PUBLIC_ROUTES}/ops/get/query/expand?`),
  });
  response.headers.push(
    { name: "ETag", type: TEXT, required: true, derivedFrom: derivedBy("cache.etag") },
    {
      name: "X-Trace",
      type: TEXT,
      required: false,
      origin: declaredAt(`${PUBLIC_ROUTES}/ops/get/headers/X-Trace`),
    },
  );
  getTask.responses?.push({
    status: 304,
    shape: "empty",
    headers: [],
    derivedFrom: derivedBy("cache.notModified"),
  });

  const sortKey = operationOf(draft, "listTasks").paging?.sortKeys[0];

  if (sortKey === undefined) throw new Error("the public listTasks has no sort key");
  sortKey.right = "tasks.sort";
  sortKey.derivedFrom = derivedBy("sortKey.restricted");

  const updateTask = operationOf(draft, "updateTask");

  if (updateTask.input === undefined || updateTask.concurrency === undefined)
    throw new Error("the public updateTask has no input or concurrency");
  updateTask.input.rawBody = false;
  updateTask.input.bodyLimitBytes = 1024;
  updateTask.input.proofs = [];
  updateTask.concurrency.derivedFrom = derivedBy("concurrency.version");

  return draft;
}

const relayFrom = (pointer: string): IrWriter.DerivedFrom => ({
  derivation: "relay.route",
  from: [{ api: PUBLIC_API, layer: "api", pointer }],
});

function runService(
  routes: string,
  options: {
    readonly catalogues?: string;
    readonly relayed?: ReadonlyMap<string, DraftIR>;
    readonly imports?: ReadonlyMap<string, ContractIR>;
  },
) {
  const workspace = treeNodesLoadInline(serviceApi(routes, options.catalogues));
  const raw = treeNodesApiOf(workspace);
  const run = treeNodesRun(raw, workspace, {
    treeSchemas: treeNodesStubService({ typeUses: {} }),
    ...(options.relayed === undefined ? {} : { relayed: options.relayed }),
    ...(options.imports === undefined ? {} : { imports: options.imports }),
  });

  return { ...run, raw };
}

// The IR of the public api as an import gives it: the members a compiled IR holds beside the draft's.
function importedIr(
  draft: DraftIR,
  edit: (ir: Record<string, unknown>) => void = () => {},
): ContractIR {
  const ir: Record<string, unknown> = JSON.parse(JSON.stringify(draft));

  edit(ir);
  const imported: ContractIR = JSON.parse(
    JSON.stringify({ irVersion: "1.0", irRevision: IR_REVISION, kinds: [], features: [], ...ir }),
  );

  return imported;
}

function findOperation(ir: Record<string, unknown>, id: string) {
  const operations = ir.operations;

  if (!Array.isArray(operations)) throw new Error("the imported IR has no operations");

  return operations.find((operation) => operation.id === id);
}

function pagingStyleOf(ir: Record<string, unknown>, id: string) {
  const pagings = ir.pagings;

  if (typeof pagings !== "object" || pagings === null)
    throw new Error("the imported IR has no paging styles");

  return Reflect.get(pagings, id);
}

test("relay routes copy the public shape", () => {
  const { draft, diagnostics } = runService(ACCEPTED_ROUTES, {
    relayed: new Map([[PUBLIC_API, publicDraft()]]),
  });

  expect(diagnostics).toEqual([]);
  const getTask = operationOf(draft, "getTask");
  const fromGet = relayFrom(`${PUBLIC_ROUTES}/ops/get`);

  expect(getTask).toMatchObject({
    method: "get",
    safe: true,
    path: "/internal/v1/channels/{channelId}/tasks/{taskId}",
    format: "bare",
    relays: { kind: "httpOperation", api: PUBLIC_API, id: "getTask" },
  });
  // The credential param, the ETag header and the not-modified response are the relay route's own to derive.
  expect(getTask.params?.header).toEqual([]);
  expect(getTask.params?.query).toEqual([
    {
      name: "expand",
      type: TEXT,
      required: false,
      origin: { api: PUBLIC_API, ...declaredAt(`${PUBLIC_ROUTES}/ops/get/query/expand?`) },
      derivedFrom: fromGet,
    },
  ]);
  expect(getTask.responses?.map(({ status }) => status)).toEqual([200]);
  expect(getTask.responses?.[0]).toMatchObject({
    origin: { api: PUBLIC_API, ...declaredAt(`${PUBLIC_ROUTES}/item`) },
    derivedFrom: fromGet,
    headers: [
      {
        name: "X-Trace",
        origin: { api: PUBLIC_API, ...declaredAt(`${PUBLIC_ROUTES}/ops/get/headers/X-Trace`) },
        derivedFrom: fromGet,
      },
    ],
  });

  // Sort keys keep their key and origin only; the copied paging style joins this api's catalogue.
  const paging = operationOf(draft, "listTasks").paging;

  expect(paging?.sortKeys).toEqual([
    {
      key: "createdAt",
      origin: { api: PUBLIC_API, ...declaredAt(`${PUBLIC_ROUTES}/ops/list/sortable/0`) },
    },
  ]);
  expect(paging).toMatchObject({ style: "cursor", maxLimit: 50, overLimit: "reject" });
  expect(paging?.origin.api).toBe(PUBLIC_API);
  expect(draft.pagings.cursor?.origin.api).toBe(PUBLIC_API);
  expect(draft.formats.bare?.origin).toEqual({ layer: "core", pointer: "/formats/bare" });

  // A batch read keeps its table response, stamped as a relay copy.
  expect(operationOf(draft, "getTasksBatch").responses?.[0]).toMatchObject({
    shape: "table",
    derivedFrom: relayFrom(`${PUBLIC_ROUTES}/ops/batch`),
  });
  expect(operationOf(draft, "getTasksBatch").safe).toBe(true);

  // Concurrency without its derivation, the input without the facts the relay route derives itself.
  const updateTask = operationOf(draft, "updateTask");

  expect(updateTask.concurrency).toEqual({
    version: { in: "body", name: "expectedVersion" },
    field: "version",
  });
  expect(Object.keys(updateTask.input ?? {}).sort()).toEqual(["media", "origin", "schema"]);
  expect(updateTask.input?.origin.api).toBe(PUBLIC_API);

  // `operationId` lets a route relay an operation of another id.
  expect(operationOf(draft, "addTask")).toMatchObject({
    method: "post",
    relays: { kind: "httpOperation", api: PUBLIC_API, id: "createTask" },
  });
});

test("relay routes copy from an imported IR the same shape, and name what it holds unknown", () => {
  const relayed = runService(ACCEPTED_ROUTES, { relayed: new Map([[PUBLIC_API, publicDraft()]]) });
  const imported = runService(ACCEPTED_ROUTES, {
    imports: new Map([[PUBLIC_API, importedIr(publicDraft())]]),
  });

  expect(imported.diagnostics).toEqual([]);
  expect(imported.draft.operations).toEqual(relayed.draft.operations);
  expect(imported.draft.pagings).toEqual(relayed.draft.pagings);

  // An unknown union arm in getTask, an unknown open-enum value in listTasks; one in health, which no route
  // relays, stops nothing.
  const withUnknowns = importedIr(publicDraft(), (ir) => {
    const operations = ir.operations;

    if (!Array.isArray(operations)) throw new Error("the imported IR has no operations");
    const byId = (id: string) => operations.find((operation) => operation.id === id);

    byId("getTask").responses[0].body = { kind: "stream", of: "Task" };
    byId("listTasks").paging.overLimit = "truncate";
    byId("health").unknownQuery = { policy: "forward" };
  });
  const refused = runService(ACCEPTED_ROUTES, { imports: new Map([[PUBLIC_API, withUnknowns]]) });

  expect(refused.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/relay-unknown", `${ROUTES}/getTask/relays`],
    ["seampact/tree/relay-unknown", `${ROUTES}/listTasks/relays`],
  ]);
  expect(refused.diagnostics[0]?.message).toMatch(
    /stream at \/operations\/\d+\/responses\/0\/body\/kind/,
  );
  expect(refused.diagnostics[1]?.message).toContain("truncate at /operations/");
  expect(operationOf(refused.draft, "getTask")).toMatchObject({ responses: [] });
  expect(operationOf(refused.draft, "getTask")).not.toHaveProperty("relays");
});

test("an imported operation holding a member this compiler does not know is refused once, naming it", () => {
  const withMember = importedIr(publicDraft(), (ir) => {
    const operations = ir.operations;

    if (!Array.isArray(operations)) throw new Error("the imported IR has no operations");
    operations.find((operation) => operation.id === "getTask").retryBudget = 3;
  });
  const refused = runService(ACCEPTED_ROUTES, { imports: new Map([[PUBLIC_API, withMember]]) });

  expect(refused.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/relay-unknown", `${ROUTES}/getTask/relays`],
  ]);
  expect(refused.diagnostics[0]?.message).toMatch(/retryBudget at \/operations\/\d+\/retryBudget/);
});

test("tree.nodes diagnostics are located: relays", () => {
  // A second public api whose wire format and paging style differ from the first one's.
  const otherApi = publicDraft();
  const bare = otherApi.formats.bare;
  const cursor = otherApi.pagings.cursor;

  if (bare === undefined || cursor === undefined)
    throw new Error("the public api has no bare or cursor");
  bare.absent = "null";
  cursor.absent = "null";

  const { diagnostics, raw } = runService(
    `
      ghost: { relays: billing.getInvoice }
      getNothing: { relays: tasks.getNothing }
      fetchTask: { relays: tasks.getTask }
      listTasks: { relays: tasks.listTasks }
      listChannels: { relays: other.listChannels }
`,
    {
      relayed: new Map([
        [PUBLIC_API, publicDraft()],
        ["other", otherApi],
      ]),
    },
  );

  expect(
    diagnostics.map(({ rule, origin }) => [rule.replace("seampact/tree/", ""), origin.pointer]),
  ).toEqual([
    ["relay-target", `${ROUTES}/ghost/relays`],
    ["relay-target", `${ROUTES}/getNothing/relays`],
    ["relay-name", `${ROUTES}/fetchTask`],
    ["relay-declaration", `${ROUTES}/listChannels/relays`],
    ["relay-declaration", `${ROUTES}/listChannels/relays`],
  ]);
  expect(diagnostics[3]?.related.map(({ message }) => message)).toEqual([
    "the wire format bare of this api",
    "the wire format bare of other.listChannels",
  ]);
  expect(diagnostics[4]?.related.map(({ message }) => message)).toEqual([
    "the paging style cursor copied for the relay route listTasks",
    "the paging style cursor of other.listChannels",
  ]);

  for (const diagnostic of diagnostics) {
    expect(diagnostic.message.endsWith(".")).toBe(true);
    expect(diagnostic.fix).not.toBe("");

    // An origin in the other api resolves in that api's table.
    for (const origin of [
      diagnostic.origin,
      ...diagnostic.related.map((related) => related.origin),
    ])
      if (origin.api === undefined)
        expect(Object.hasOwn(raw.locations, diagnosticLocationKey(origin))).toBe(true);
  }
});

test("an imported operation that contradicts its own IR is refused, located, not an internal error", () => {
  const outsidePrefix = importedIr(publicDraft(), (ir) => {
    findOperation(ir, "getTask").path = "/elsewhere/tasks/{taskId}";
  });
  const nextSegment = importedIr(publicDraft(), (ir) => {
    findOperation(ir, "getTask").path = "/internal/v10/tasks/{taskId}";
  });
  const longPath = importedIr(publicDraft(), (ir) => {
    findOperation(ir, "getTask").path = `/elsewhere/${"x".repeat(500)}`;
  });
  const noSurface = importedIr(publicDraft(), (ir) => {
    findOperation(ir, "getTask").surface = "ghostSurface";
  });
  const noFormat = importedIr(publicDraft(), (ir) => {
    findOperation(ir, "listTasks").format = "missing";
  });
  const noStyle = importedIr(publicDraft(), (ir) => {
    findOperation(ir, "listTasks").paging.style = "missing";
  });
  const unknownKind = importedIr(publicDraft(), (ir) => {
    findOperation(ir, "getTask").kind = "grpcOperation";
  });

  const run = (imported: ContractIR) =>
    runService(ACCEPTED_ROUTES, { imports: new Map([[PUBLIC_API, imported]]) }).diagnostics;
  const located = (imported: ContractIR) =>
    run(imported).map(({ rule, origin }) => [rule, origin.pointer]);

  expect(located(outsidePrefix)).toEqual([
    ["seampact/tree/relay-target", `${ROUTES}/getTask/relays`],
  ]);
  expect(run(outsidePrefix)[0]?.message).toContain("does not start with the prefix of its surface");
  expect(located(nextSegment)).toEqual([
    ["seampact/tree/relay-target", `${ROUTES}/getTask/relays`],
  ]);
  expect(located(longPath)).toEqual([["seampact/tree/relay-target", `${ROUTES}/getTask/relays`]]);
  expect(run(longPath)[0]?.message.length).toBeLessThan(400);
  expect(located(noSurface)).toEqual([["seampact/tree/relay-target", `${ROUTES}/getTask/relays`]]);
  expect(run(noSurface)[0]?.message).toContain(
    "surface ghostSurface, which the import does not declare",
  );
  expect(located(noFormat)).toEqual([["seampact/tree/relay-target", `${ROUTES}/listTasks/relays`]]);
  expect(located(noStyle)).toEqual([["seampact/tree/relay-target", `${ROUTES}/listTasks/relays`]]);
  expect(located(unknownKind)).toEqual([
    ["seampact/tree/relay-unknown", `${ROUTES}/getTask/relays`],
  ]);
  expect(run(unknownKind)[0]?.message).toContain("grpcOperation");
});

test("an imported paging style holding a member this compiler does not know is refused, not copied", () => {
  const withMember = importedIr(publicDraft(), (ir) => {
    pagingStyleOf(ir, "cursor").weight = 1;
  });
  const refused = runService(ACCEPTED_ROUTES, { imports: new Map([[PUBLIC_API, withMember]]) });

  expect(refused.diagnostics.map(({ rule, origin }) => [rule, origin.pointer])).toEqual([
    ["seampact/tree/relay-unknown", `${ROUTES}/listTasks/relays`],
  ]);
  expect(refused.diagnostics[0]?.message).toContain("weight at /pagings/cursor/weight");
  expect(refused.draft.pagings).not.toHaveProperty("cursor.weight");
});
