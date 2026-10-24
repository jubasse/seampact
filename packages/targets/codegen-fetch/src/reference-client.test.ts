import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GeneratedFile, Target } from "@seampact/codegen-core";
import {
  referencePageShape,
  referenceUnpagedList,
} from "@seampact/codegen-core/node-server/test-support";
import type { ContractIR, Template } from "@seampact/spec/ir";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { target as clientTarget } from "./index.js";

// The consumer layout of the run script, under the package's git-ignored `.vitest/`. Its `node_modules` links the
// workspace packages a consumer installs, so the stub server imports the runtime helpers by name; this package
// itself depends on none of them (ADR 0009 "Dependency rules").
const PROJECT = fileURLToPath(new URL("../.vitest/reference-client/", import.meta.url));
const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const LINKED_PACKAGES = {
  "@seampact/codegen-ts": "packages/targets/codegen-ts",
  "@seampact/hooks": "packages/runtime/hooks",
  "@seampact/http-suite": "packages/tools/http-suite",
  "@seampact/idempotency-memory": "packages/runtime/idempotency-memory",
  "@seampact/signed-webhooks": "packages/runtime/signed-webhooks",
};
const CONSUMERS = new URL("scripts/consumers/", REPOSITORY_ROOT);
const APIS = ["tasks", "tasksService"] as const;
// The tasks api with `listChannels` declared `paging: none`, generated beside the goldens.
const UNPAGED_API = "tasksUnpaged";
// The tasks api with the `cursor` style answering other page shapes, and the pack-laravel golden.
const META_PAGE_API = "tasksMetaPage";
const FLAT_PAGE_API = "tasksFlatPage";
const HEADER_PAGE_API = "tasksHeaderPage";
const LARAVEL_API = "laravelTasks";
const LARAVEL_UNPAGED_API = "laravelTasksUnpaged";
const SINCE_PAGE_API = "tasksSincePage";
const RESULT_CLIENT = "client";
const THROW_CLIENT = "clientThrow";
const PROBE_FILE = "probe.ts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEADLINE_TOLERANCE_MS = 1000;
// The setup generates and type-checks two APIs, which outlasts the default hook timeout on a loaded machine.
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

type Method = (request?: unknown, options?: unknown) => Promise<Record<string, unknown>>;

interface ClientModule {
  createClient(config: {
    baseUrl: string;
    fetch?: typeof fetch;
    headers?: Record<string, string>;
    idempotencyKey?: () => string;
  }): Record<string, Method>;
  isClientContractError?: (error: unknown) => boolean;
}

interface StubModule {
  startServer(): Promise<{ baseUrl: string; close(): Promise<void> }>;
  SLOW_SEARCH_TEXT: string;
}

interface CredentialsModule {
  USER_TOKEN: string;
  THROTTLED_USER_TOKEN: string;
  SERVICE_JWT: string;
  bearer(token: string): string;
  stripeSignature(body: unknown): string;
}

interface SentRequest {
  url: URL;
  headers: Headers;
}

const sent: SentRequest[] = [];
let stub: Awaited<ReturnType<StubModule["startServer"]>>;
let credentials: CredentialsModule;
let slowSearchText: string;
let tasks: Record<string, Method>;
let service: Record<string, Method>;
let throwing: Record<string, Method>;
let createResultClient: ClientModule["createClient"];
let isClientContractError: (error: unknown) => boolean;
let typesTarget: Target;

function readGoldenIr(name: string, golden = "reference"): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/${golden}/${name}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

const slot = (name: string): Template => ({ kind: "slot", slot: name, path: [] });
const object = (members: Record<string, Template>): Template => ({
  kind: "object",
  members: Object.entries(members).map(([name, value]) => ({
    name: { kind: "text", text: name },
    value,
  })),
});

// `{ data: $items, meta: $meta }`, the style adding its members to `$meta`.
function metaPageIr(): ContractIR {
  return referencePageShape({
    styleId: "cursor",
    formatPageBody: object({ data: slot("items"), meta: slot("meta") }),
    response: {
      meta: [
        { name: "nextCursor", value: slot("nextCursor") },
        { name: "perPage", value: slot("limit") },
      ],
      headers: [],
      links: [],
    },
    handlerResult: ["nextCursor"],
  })(readGoldenIr("tasks"), "tasks");
}

// Flat members beside `$items`, with a literal the client leaves alone.
function flatPageIr(): ContractIR {
  return referencePageShape({
    styleId: "cursor",
    response: {
      body: object({
        object: { kind: "literal", value: "list" },
        items: slot("items"),
        next_cursor: slot("nextCursor"),
        limit: slot("limit"),
        url: slot("path"),
      }),
      meta: [],
      headers: [],
      links: [],
    },
    handlerResult: ["nextCursor"],
  })(readGoldenIr("tasks"), "tasks");
}

// A bare array, the facts in headers and in `Link`.
function headerPageIr(): ContractIR {
  return referencePageShape({
    styleId: "cursor",
    response: {
      body: slot("items"),
      meta: [],
      headers: [
        { name: "X-Total-Count", value: slot("total") },
        { name: "X-More", value: slot("more") },
      ],
      links: [
        { rel: "first", role: "first" },
        { rel: "prev", role: "previous" },
        { rel: "next", role: "next" },
        { rel: "last", role: "last" },
      ],
    },
    handlerResult: ["nextCursor", "total"],
  })(readGoldenIr("tasks"), "tasks");
}

// A since style: the page tells where the next sync starts and whether the feed is complete.
function sincePageIr(): ContractIR {
  const ir = referencePageShape({
    styleId: "cursor",
    response: {
      body: object({
        data: slot("items"),
        next_since: slot("nextSince"),
        complete: slot("complete"),
      }),
      meta: [],
      headers: [],
      links: [],
    },
    handlerResult: ["nextCursor"],
  })(readGoldenIr("tasks"), "tasks");
  const { cursor } = ir.pagings;

  if (cursor === undefined) throw new Error("the tasks api has no cursor paging style");

  return { ...ir, pagings: { ...ir.pagings, cursor: { ...cursor, position: "since" } } };
}

function unpagedTasksIr(): ContractIR {
  return referenceUnpagedList("listChannels")(readGoldenIr("tasks"), "tasks");
}

function writeFiles(directory: string, files: readonly GeneratedFile[]): string[] {
  return files.map((file) => {
    const path = join(PROJECT, directory, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);

    return path;
  });
}

async function generateApi(api: string, ir: ContractIR = readGoldenIr(api)): Promise<string[]> {
  const types = await typesTarget.generate({
    ir,
    options: {},
    links: {},
    artefacts: new Set(["types"]),
  });
  const described = typesTarget.describe(ir, {});

  if (types.status !== "generated" || described.status !== "described") {
    throw new Error(`codegen-ts refused ${api}: ${JSON.stringify([types, described])}`);
  }

  const descriptor = described.descriptors.types;

  if (descriptor === undefined) throw new Error("codegen-ts described no types link");

  const paths = writeFiles(`generated/types/${api}`, types.files);

  for (const [directory, errorStyle] of [
    [RESULT_CLIENT, "result"],
    [THROW_CLIENT, "throw"],
  ] as const) {
    const client = await clientTarget.generate({
      ir,
      options: { errorStyle },
      links: { types: { descriptor, location: { kind: "relative", path: `../../types/${api}` } } },
      artefacts: new Set(["client"]),
    });

    if (client.status !== "generated") {
      throw new Error(`codegen-fetch refused ${api}: ${JSON.stringify(client.refusals, null, 2)}`);
    }

    paths.push(...writeFiles(`generated/${directory}/${api}`, client.files));
  }

  return paths;
}

function copyConsumerFile(from: string, to: string): void {
  const path = join(PROJECT, to);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(new URL(from, CONSUMERS)));
}

// Type uses the generated declarations must accept or refuse; zero diagnostics means each holds.
const PROBE = `
import { createClient } from "./generated/client/tasks/client.js";
import { createClient as createServiceClient } from "./generated/client/tasksService/client.js";
import { createClient as createThrowingClient, isClientContractError } from "./generated/clientThrow/tasks/client.js";
import { createClient as createUnpagedClient } from "./generated/client/tasksUnpaged/client.js";
import { createClient as createHeaderPageClient } from "./generated/client/tasksHeaderPage/client.js";
import { createClient as createLaravelClient } from "./generated/client/laravelTasks/client.js";

import * as TasksIndex from "./generated/client/tasks/index.js";

// The public runtime names are reachable through the index.
export type IndexedNames = [
  TasksIndex.ClientConfig,
  TasksIndex.CallOptions,
  TasksIndex.TimedCallOptions,
  TasksIndex.CallResult<unknown, unknown>,
  TasksIndex.SuccessResult<unknown, unknown>,
  TasksIndex.ErrorResult<unknown>,
  TasksIndex.UnexpectedResult,
  TasksIndex.NotModifiedResult,
  TasksIndex.ReplayFlag,
  TasksIndex.Client,
  InstanceType<typeof TasksIndex.ContractError>,
];
export const indexedCreateClient: typeof createClient = TasksIndex.createClient;

const client = createClient({ baseUrl: "http://localhost" });
const serviceClient = createServiceClient({ baseUrl: "http://localhost" });
const throwingClient = createThrowingClient({ baseUrl: "http://localhost" });

export async function probe(): Promise<void> {
  await client.health();
  await client.getChannel({ path: { channelId: "c" } });
  await client.listChannels();

  const created = await client.createTask({ path: { channelId: "c" }, body: { title: "t" } });

  if (created.ok) {
    const replayed: boolean = created.replayed;
    const title: string = created.body.title;
    void [replayed, title];
  } else if (!created.unexpected && created.code === "api.rate_limited") {
    const retryAfterMs: number = created.params.retryAfterMs;
    void retryAfterMs;
  }

  const page = await client.listTasks({ path: { channelId: "c" }, query: { sort: ["-createdAt"] } });

  if (page.ok) {
    const nextCursor: string | undefined = page.body.nextCursor;
    void nextCursor;
  }

  const channels = await createUnpagedClient({ baseUrl: "http://localhost" }).listChannels();

  if (channels.ok) {
    const channelIds: string[] = channels.body.map((channel) => channel.channelId);
    void channelIds;
  }

  const headerPage = await createHeaderPageClient({ baseUrl: "http://localhost" }).listTasks({ path: { channelId: "c" } });

  if (headerPage.ok) {
    const total: number = headerPage.body.total;
    const next: string | undefined = headerPage.body.next;
    void [total, next];
  }

  const laravel = createLaravelClient({ baseUrl: "http://localhost" });
  const laravelPage = await laravel.listTasks({ path: { channelId: "c" }, query: { page: 2 } });

  if (laravelPage.ok) {
    const totals: number[] = [laravelPage.body.total, laravelPage.body.totalPages, laravelPage.body.page];
    const from: number | undefined = laravelPage.body.from;
    void [totals, from];
  }

  const laravelTask = await laravel.getTask({ path: { channelId: "c", taskId: "t" } });

  if (laravelTask.ok) void laravelTask.body.title;

  const preferences = await client.getPreferences();

  if (preferences.ok && preferences.status === 304) void preferences.headers;

  await serviceClient.getTask({ path: { channelId: "c", taskId: "t" }, headers: { authorization: "a" } }, { timeoutMs: 1 });

  // @ts-expect-error an operation with a deadline header and no budget needs a timeout
  await serviceClient.getTask({ path: { channelId: "c", taskId: "t" }, headers: { authorization: "a" } });

  // @ts-expect-error the body is checked by the type
  await client.createTask({ path: { channelId: "c" }, body: { title: 1 } });

  try {
    const task = await throwingClient.getTask({ path: { channelId: "c", taskId: "t" } });
    const title: string = task.body.title;
    void title;
  } catch (error) {
    if (isClientContractError(error) && error.operation === "createTask" && !error.failure.unexpected) {
      if (error.failure.code === "api.rate_limited") void error.failure.params.retryAfterMs;
    }
  }
}
`;

function typeErrorsOf(paths: readonly string[]): string[] {
  const basePath = new URL("tsconfig.base.json", REPOSITORY_ROOT).pathname;
  const { config } = ts.readConfigFile(basePath, ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, dirname(basePath));
  const program = ts.createProgram([...paths, join(PROJECT, PROBE_FILE)], options);

  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

function linkWorkspacePackages(): void {
  for (const [name, directory] of Object.entries(LINKED_PACKAGES)) {
    const link = join(PROJECT, "node_modules", name);

    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(fileURLToPath(new URL(directory, REPOSITORY_ROOT)), link, "dir");
  }
}

function recordingFetch(): typeof fetch {
  return (input, init) => {
    sent.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });

    return fetch(input, init);
  };
}

function lastSent(): SentRequest {
  const request = sent.at(-1);

  if (request === undefined) throw new Error("no request was sent");

  return request;
}

async function importProjectModule<Module>(path: string): Promise<Module> {
  return import(pathToFileURL(join(PROJECT, path)).href);
}

beforeAll(async () => {
  rmSync(PROJECT, { recursive: true, force: true });
  mkdirSync(PROJECT, { recursive: true });
  writeFileSync(join(PROJECT, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(PROJECT, PROBE_FILE), PROBE);
  copyConsumerFile("template/test/credentials.mts", "test/credentials.mts");
  copyConsumerFile("targets/stub/test/server.mts", "test/server.mts");
  copyConsumerFile("template/src/suite-control.mts", "src/suite-control.mts");
  linkWorkspacePackages();

  typesTarget = (
    await importProjectModule<{ target: Target }>("node_modules/@seampact/codegen-ts/src/index.ts")
  ).target;

  const paths = (
    await Promise.all([
      ...APIS.map((api) => generateApi(api)),
      generateApi(UNPAGED_API, unpagedTasksIr()),
      generateApi(META_PAGE_API, metaPageIr()),
      generateApi(FLAT_PAGE_API, flatPageIr()),
      generateApi(HEADER_PAGE_API, headerPageIr()),
      generateApi(LARAVEL_API, readGoldenIr("tasks", "pack-laravel")),
      generateApi(
        LARAVEL_UNPAGED_API,
        referenceUnpagedList("listChannels")(readGoldenIr("tasks", "pack-laravel"), "tasks"),
      ),
      generateApi(SINCE_PAGE_API, sincePageIr()),
    ])
  ).flat();

  expect(typeErrorsOf(paths)).toEqual([]);

  const stubModule = await importProjectModule<StubModule>("test/server.mts");
  const config = { fetch: recordingFetch() };

  stub = await stubModule.startServer();
  slowSearchText = stubModule.SLOW_SEARCH_TEXT;
  credentials = await importProjectModule<CredentialsModule>("test/credentials.mts");

  const resultModule = await importProjectModule<ClientModule>("generated/client/tasks/client.ts");
  const serviceModule = await importProjectModule<ClientModule>(
    "generated/client/tasksService/client.ts",
  );
  const throwModule = await importProjectModule<ClientModule>(
    "generated/clientThrow/tasks/client.ts",
  );

  createResultClient = resultModule.createClient;
  tasks = resultModule.createClient({ baseUrl: stub.baseUrl, ...config });
  service = serviceModule.createClient({ baseUrl: stub.baseUrl, ...config });
  throwing = throwModule.createClient({ baseUrl: stub.baseUrl, ...config });

  if (throwModule.isClientContractError === undefined) {
    throw new Error("the throw-style client exports no isClientContractError");
  }

  isClientContractError = throwModule.isClientContractError;
}, SETUP_TIMEOUT_MILLISECONDS);

afterAll(async () => {
  await stub?.close();
  rmSync(PROJECT, { recursive: true, force: true });
});

interface CannedAnswer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

// A booted server answering the next canned response, for the page shapes the stub server does not serve.
async function startCannedServer() {
  let next: CannedAnswer = { status: 500, body: null };
  const server = createServer((_request, response) => {
    response.writeHead(next.status, { "content-type": "application/json", ...next.headers });
    response.end(JSON.stringify(next.body));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  if (address === null || typeof address === "string")
    throw new Error("the canned server has no port");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    answerNext(answer: CannedAnswer): void {
      next = answer;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function cannedClient(api: string, canned: { baseUrl: string }) {
  const module = await importProjectModule<ClientModule>(`generated/client/${api}/client.ts`);

  return module.createClient({ baseUrl: canned.baseUrl });
}

function call(client: Record<string, Method>, operation: string): Method {
  const method = client[operation];

  if (method === undefined) throw new Error(`the client has no method '${operation}'`);

  return method;
}

const user = () => ({ authorization: credentials.bearer(credentials.USER_TOKEN) });

describe("the generated reference client answers a stub server", () => {
  test("an item, a table and an empty success", async () => {
    await expect(call(tasks, "health")()).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: { status: "ok" },
    });
    await expect(
      call(
        tasks,
        "getTasksBatch",
      )({
        path: { channelId: "c1" },
        headers: user(),
        body: { ids: ["a", "b"] },
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: 200,
      body: { a: { taskId: "a" }, b: { taskId: "b" } },
    });
    await expect(
      call(
        tasks,
        "purgeTask",
      )({
        path: { channelId: "c1", taskId: "t1" },
        headers: user(),
        body: { reauthToken: "r" },
      }),
    ).resolves.toMatchObject({ ok: true, status: 204, replayed: false });
  });

  test("a page with its next cursor, and the listTasks query string", async () => {
    const first = await call(
      tasks,
      "listTasks",
    )({
      path: { channelId: "c 1" },
      query: { limit: 2, sort: ["-createdAt", "createdAt"] },
      headers: user(),
    });

    expect(lastSent().url.pathname).toBe("/v1/channels/c%201/tasks");
    expect(lastSent().url.search).toBe("?limit=2&sort=-createdAt,createdAt");
    expect(first).toMatchObject({ ok: true, status: 200, body: { nextCursor: "cursor-2" } });
    expect(first.body).toMatchObject({ items: [{ taskId: "task-1" }, { taskId: "task-2" }] });

    const last = await call(
      tasks,
      "listTasks",
    )({
      path: { channelId: "c1" },
      query: { cursor: "cursor-2" },
      headers: user(),
    });

    expect(last.body).not.toHaveProperty("nextCursor");
  });

  test("the derived 304 of an ETag", async () => {
    const fresh = await call(tasks, "getPreferences")({ headers: user() });
    const etag = (fresh.headers as Headers).get("etag");

    expect(fresh).toMatchObject({ ok: true, status: 200, body: { locale: "en" } });
    await expect(
      call(tasks, "getPreferences")({ headers: { ...user(), "if-none-match": etag } }),
    ).resolves.toMatchObject({ ok: true, status: 304 });
  });

  test("401, 400 and 429 as declared errors with their params", async () => {
    await expect(
      call(tasks, "getTask")({ path: { channelId: "c1", taskId: "t1" } }),
    ).resolves.toMatchObject({
      ok: false,
      unexpected: false,
      status: 401,
      code: "api.unauthenticated",
    });
    await expect(
      call(
        tasks,
        "createTask",
      )({ path: { channelId: "c1" }, headers: user(), body: { title: "" } }),
    ).resolves.toMatchObject({
      ok: false,
      status: 400,
      code: "api.schema_invalid",
      params: { issues: [{ pointer: "/title" }] },
    });

    const throttled = await call(
      tasks,
      "createTask",
    )({
      path: { channelId: "c1" },
      headers: { authorization: credentials.bearer(credentials.THROTTLED_USER_TOKEN) },
      body: { title: "Throttled" },
    });

    expect(throttled).toEqual(
      expect.objectContaining({
        status: 429,
        code: "api.rate_limited",
        params: { retryAfterMs: 1500 },
      }),
    );
  });

  test("the generated idempotency key and the replay flag", async () => {
    const request = { path: { channelId: "c1" }, headers: user(), body: { title: "Once" } };
    const created = await call(tasks, "createTask")(request);
    const key = lastSent().headers.get("idempotency-key") ?? "";

    expect(key).toMatch(UUID);
    expect(created).toMatchObject({ ok: true, status: 201, replayed: false });

    const replayed = await call(
      tasks,
      "createTask",
    )({
      ...request,
      headers: { ...user(), "idempotency-key": key },
    });

    expect(replayed).toMatchObject({ ok: true, status: 201, replayed: true, body: created.body });
  });

  test("a path parameter that is a dot segment or empty is refused", async () => {
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () => new Response(null, { status: 500 }),
    });
    const create = call(fake, "createTask");

    for (const channelId of ["..", ".", ""]) {
      await expect(
        create({ path: { channelId }, headers: user(), body: { title: "x" } }),
      ).rejects.toThrow(/channelId/);
    }
  });

  test("only a true replay header reads as replayed", async () => {
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response(JSON.stringify({ taskId: "t1", title: "x" }), {
          status: 201,
          headers: { "content-type": "application/json", "idempotency-replayed": "false" },
        }),
    });
    const created = await call(
      fake,
      "createTask",
    )({ path: { channelId: "c1" }, headers: user(), body: { title: "x" } });

    expect(created).toMatchObject({ ok: true, status: 201, replayed: false });
  });

  test("default headers may not carry the idempotency key", async () => {
    const fake = createResultClient({
      baseUrl: "http://api.test",
      headers: { "Idempotency-Key": "fixed" },
      fetch: async () => new Response(null, { status: 500 }),
    });

    await expect(
      call(
        fake,
        "createTask",
      )({ path: { channelId: "c1" }, headers: user(), body: { title: "x" } }),
    ).rejects.toThrow(/idempotency-key/i);
  });

  test("a malformed Link target gives no next cursor", async () => {
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json", link: '<http://[bad>; rel="next"' },
        }),
    });
    const page = await call(fake, "listTasks")({ path: { channelId: "c1" }, headers: user() });

    expect(page).toMatchObject({ ok: true, status: 200, body: { items: [] } });
    expect(page.body).not.toHaveProperty("nextCursor");
  });

  test("a next link is read without URL.canParse", async () => {
    const { canParse } = URL;
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response("[]", {
          status: 200,
          headers: {
            "content-type": "application/json",
            link: '<http://[bad>; rel="next", </x?cursor=c2>; rel="next"',
          },
        }),
    });

    Object.assign(URL, { canParse: undefined });

    try {
      const page = await call(fake, "listTasks")({ path: { channelId: "c1" }, headers: user() });

      expect(page).toMatchObject({ ok: true, body: { items: [] } });
      expect(page.body).not.toHaveProperty("nextCursor");
    } finally {
      Object.assign(URL, { canParse });
    }
  });

  test("a next link target reads its cursor without URL.canParse", async () => {
    const { canParse } = URL;
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json", link: '</x?q=a&cursor=c2>; rel="next"' },
        }),
    });

    Object.assign(URL, { canParse: undefined });

    try {
      const page = await call(fake, "listTasks")({ path: { channelId: "c1" }, headers: user() });

      expect(page).toMatchObject({ ok: true, body: { nextCursor: "c2" } });
    } finally {
      Object.assign(URL, { canParse });
    }
  });

  test.each([
    ["text/plain", "123"],
    ["application/json", "null"],
  ])("a %s success body %s comes back as unexpected", async (contentType, text) => {
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response(text, { status: 201, headers: { "content-type": contentType } }),
    });
    const created = await call(
      fake,
      "createTask",
    )({ path: { channelId: "c1" }, headers: user(), body: { title: "x" } });

    expect(created).toMatchObject({ ok: false, unexpected: true, status: 201 });
  });

  test("a batch read answered as an array instead of a table comes back as unexpected", async () => {
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response(JSON.stringify([{ taskId: "a" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const batch = await call(
      fake,
      "getTasksBatch",
    )({ path: { channelId: "c1" }, headers: user(), body: { ids: ["a"] } });

    expect(batch).toMatchObject({ ok: false, unexpected: true, status: 200 });
  });

  test("a paging none list reads a bare array, and an object comes back as unexpected", async () => {
    const unpaged = await importProjectModule<ClientModule>(
      `generated/client/${UNPAGED_API}/client.ts`,
    );
    const answering = (body: unknown) =>
      unpaged.createClient({
        baseUrl: "http://api.test",
        fetch: async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      });

    const list = await call(answering([{ channelId: "c1" }]), "listChannels")();
    const object = await call(answering({ items: [] }), "listChannels")();

    expect(list).toMatchObject({ ok: true, status: 200, body: [{ channelId: "c1" }] });
    expect(object).toMatchObject({ ok: false, unexpected: true, status: 200 });
  });

  test("a success body that is not JSON comes back as unexpected", async () => {
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () =>
        new Response("<html>maintenance</html>", {
          status: 201,
          headers: { "content-type": "text/html" },
        }),
    });
    const created = await call(
      fake,
      "createTask",
    )({ path: { channelId: "c1" }, headers: user(), body: { title: "x" } });

    expect(created).toMatchObject({
      ok: false,
      unexpected: true,
      status: 201,
      body: "<html>maintenance</html>",
    });
  });

  test("the idempotency key generator of the config replaces crypto.randomUUID", async () => {
    vi.stubGlobal("crypto", undefined);

    try {
      expect(() => createResultClient({ baseUrl: "http://api.test" })).toThrow(/idempotencyKey/);

      const fake = createResultClient({
        baseUrl: "http://api.test",
        idempotencyKey: () => "generated-key",
        fetch: async (input, init) => {
          sent.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });

          return new Response(null, { status: 500 });
        },
      });

      await call(
        fake,
        "createTask",
      )({ path: { channelId: "c1" }, headers: user(), body: { title: "x" } });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(lastSent().headers.get("idempotency-key")).toBe("generated-key");
  });

  test("a platform without AbortSignal.any or AbortSignal.timeout still applies the timeout", async () => {
    const { any, timeout } = AbortSignal;
    const caller = new AbortController();
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    });

    Object.assign(AbortSignal, { any: undefined, timeout: undefined });

    try {
      await expect(
        call(fake, "listTasks")(
          { path: { channelId: "c1" }, headers: user() },
          { signal: caller.signal, timeoutMs: 5 },
        ),
      ).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      Object.assign(AbortSignal, { any, timeout });
    }
  });

  test("the fallback signals leave no listener on the caller's signal once the call settled", async () => {
    const { any, timeout } = AbortSignal;
    const caller = new AbortController();
    const removed = vi.spyOn(caller.signal, "removeEventListener");
    const fake = createResultClient({
      baseUrl: "http://api.test",
      fetch: async () => new Response(null, { status: 500 }),
    });

    Object.assign(AbortSignal, { any: undefined, timeout: undefined });

    try {
      await call(fake, "listTasks")(
        { path: { channelId: "c1" }, headers: user() },
        { signal: caller.signal, timeoutMs: 60_000 },
      );
    } finally {
      Object.assign(AbortSignal, { any, timeout });
    }

    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  test("a Hermes-like runtime works through the injected key generator and refuses by name without it", async () => {
    const { any, timeout } = AbortSignal;
    const { canParse } = URL;
    const hermesFetch: typeof fetch = async (_input, init) => {
      sent.push({ url: new URL(String(_input)), headers: new Headers(init?.headers) });

      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json", link: '</x?cursor=c2>; rel="next"' },
      });
    };

    vi.stubGlobal("crypto", undefined);
    Object.assign(AbortSignal, { any: undefined, timeout: undefined });
    Object.assign(URL, { canParse: undefined });

    try {
      expect(() => createResultClient({ baseUrl: "http://api.test", fetch: hermesFetch })).toThrow(
        /crypto\.randomUUID.*idempotencyKey/,
      );

      const hermes = createResultClient({
        baseUrl: "http://api.test",
        fetch: hermesFetch,
        idempotencyKey: () => "expo-key",
      });
      const page = await call(hermes, "listTasks")(
        { path: { channelId: "c1" }, headers: user() },
        { signal: new AbortController().signal, timeoutMs: 5000 },
      );

      expect(page).toMatchObject({ ok: true, body: { nextCursor: "c2" } });

      await call(
        hermes,
        "createTask",
      )({ path: { channelId: "c1" }, headers: user(), body: { title: "x" } });
      expect(lastSent().headers.get("idempotency-key")).toBe("expo-key");
    } finally {
      vi.unstubAllGlobals();
      Object.assign(AbortSignal, { any, timeout });
      Object.assign(URL, { canParse });
    }
  });

  test("the deadline header on tasksService", async () => {
    const before = Date.now();
    const answer = await call(service, "getTask")(
      {
        path: { channelId: "c1", taskId: "t1" },
        headers: { authorization: credentials.bearer(credentials.SERVICE_JWT) },
      },
      { timeoutMs: 2000 },
    );
    const deadline = Date.parse(lastSent().headers.get("x-deadline") ?? "");

    expect(answer).toMatchObject({ ok: true, status: 200, body: { taskId: "t1" } });
    expect(lastSent().headers.get("x-deadline")).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(Math.abs(deadline - (before + 2000))).toBeLessThan(DEADLINE_TOLERANCE_MS);
  });

  test("the budget aborts a slow call", async () => {
    await expect(
      call(
        tasks,
        "searchTasks",
      )({
        path: { channelId: "c1" },
        headers: user(),
        body: { text: slowSearchText },
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  test("a signed webhook passes and a bad signature is refused", async () => {
    const event = { id: "evt_1", type: "invoice.paid", data: {} };

    await expect(
      call(
        tasks,
        "payments",
      )({
        headers: { "stripe-signature": credentials.stripeSignature(event) },
        body: event,
      }),
    ).resolves.toMatchObject({ ok: true, status: 204 });
    await expect(
      call(
        tasks,
        "payments",
      )({
        headers: { "stripe-signature": credentials.stripeSignature({ ...event, id: "evt_2" }) },
        body: event,
      }),
    ).resolves.toMatchObject({ ok: false, status: 401, code: "api.unauthenticated" });
  });

  test("errorStyle throw returns the success and throws the declared error", async () => {
    await expect(
      call(throwing, "getTask")({ path: { channelId: "c1", taskId: "t1" }, headers: user() }),
    ).resolves.toMatchObject({ ok: true, status: 200 });

    const thrown = await call(
      throwing,
      "getTask",
    )({ path: { channelId: "c1", taskId: "t1" } }).catch((error: unknown) => error);

    expect(isClientContractError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      operation: "getTask",
      failure: { ok: false, unexpected: false, status: 401, code: "api.unauthenticated" },
    });
  });
});

describe("the generated client reads every page shape of its paging style", () => {
  const tasks = [{ taskId: "task-1" }, { taskId: "task-2" }];
  let canned: Awaited<ReturnType<typeof startCannedServer>>;

  beforeAll(async () => {
    canned = await startCannedServer();
  });

  afterAll(async () => {
    await canned?.close();
  });

  test("a { data, meta } page joins the style's meta members", async () => {
    const client = await cannedClient(META_PAGE_API, canned);

    canned.answerNext({
      status: 200,
      body: { data: tasks, meta: { nextCursor: "cursor-2", perPage: 2 } },
    });

    await expect(call(client, "listTasks")({ path: { channelId: "c1" } })).resolves.toMatchObject({
      ok: true,
      body: { items: tasks, nextCursor: "cursor-2", limit: 2 },
    });

    canned.answerNext({ status: 200, body: { data: tasks, meta: { perPage: 2 } } });

    const last = await call(client, "listTasks")({ path: { channelId: "c1" } });

    expect(last.body).toEqual({ items: tasks, limit: 2 });
  });

  test("a page body with flat members beside its items", async () => {
    const client = await cannedClient(FLAT_PAGE_API, canned);

    canned.answerNext({
      status: 200,
      body: { object: "list", items: tasks, next_cursor: "cursor-2", limit: 2, url: "/v1" },
    });

    const page = await call(client, "listTasks")({ path: { channelId: "c1" } });

    expect(page).toMatchObject({ ok: true, status: 200 });
    expect(page.body).toEqual({ items: tasks, nextCursor: "cursor-2", limit: 2 });

    canned.answerNext({ status: 200, body: { object: "list", items: tasks } });

    await expect(call(client, "listTasks")({ path: { channelId: "c1" } })).resolves.toMatchObject({
      ok: false,
      unexpected: true,
      status: 200,
    });
  });

  test("a page whose facts travel in headers and in Link", async () => {
    const client = await cannedClient(HEADER_PAGE_API, canned);

    canned.answerNext({
      status: 200,
      body: tasks,
      headers: {
        "x-total-count": "7",
        "x-more": "true",
        link: '</v1/channels/c1/tasks?cursor=cursor-2>; rel="next"',
      },
    });

    const page = await call(client, "listTasks")({ path: { channelId: "c1" } });

    expect(page.body).toEqual({
      items: tasks,
      total: 7,
      more: true,
      next: "/v1/channels/c1/tasks?cursor=cursor-2",
      nextCursor: "cursor-2",
    });

    canned.answerNext({
      status: 200,
      body: tasks,
      headers: { "x-total-count": "many", "x-more": "false" },
    });

    await expect(call(client, "listTasks")({ path: { channelId: "c1" } })).resolves.toMatchObject({
      ok: false,
      unexpected: true,
    });
  });

  test("pack-laravel: data-wrapped items and a length-aware page", async () => {
    const client = await cannedClient(LARAVEL_API, canned);

    canned.answerNext({ status: 200, body: { data: { taskId: "t1", title: "Write" } } });

    await expect(
      call(client, "getTask")({ path: { channelId: "c1", taskId: "t1" } }),
    ).resolves.toMatchObject({ ok: true, body: { taskId: "t1", title: "Write" } });

    canned.answerNext({
      status: 200,
      body: {
        data: tasks,
        links: { first: "/p1", last: "/p4", prev: "/p1", next: null },
        meta: {
          current_page: 2,
          from: 3,
          last_page: 4,
          path: "/v1/channels/c1/tasks",
          per_page: 2,
          to: 4,
          total: 7,
        },
      },
    });

    const page = await call(client, "listTasks")({ path: { channelId: "c1" }, query: { page: 2 } });

    expect(page.body).toEqual({
      items: tasks,
      first: "/p1",
      last: "/p4",
      previous: "/p1",
      page: 2,
      from: 3,
      totalPages: 4,
      limit: 2,
      to: 4,
      total: 7,
    });
  });

  test("pack-laravel: data-wrapped list and table payloads", async () => {
    const tableClient = await cannedClient(LARAVEL_API, canned);
    const batch = { a: { taskId: "a" }, b: { taskId: "b" } };

    canned.answerNext({ status: 200, body: { data: batch } });

    await expect(
      call(tableClient, "getTasksBatch")({ path: { channelId: "c1" }, body: { ids: ["a", "b"] } }),
    ).resolves.toMatchObject({ ok: true, body: batch });

    const listClient = await cannedClient(LARAVEL_UNPAGED_API, canned);
    const channels = [{ channelId: "c1" }];

    canned.answerNext({ status: 200, body: { data: channels } });

    const list = await call(listClient, "listChannels")();

    expect(list).toMatchObject({ ok: true, status: 200 });
    expect(list.body).toEqual(channels);
  });

  test("a since page reads its next start and whether the feed is complete", async () => {
    const client = await cannedClient(SINCE_PAGE_API, canned);

    canned.answerNext({
      status: 200,
      body: { data: tasks, next_since: "2026-10-21T10:00:00Z", complete: false },
    });

    const page = await call(client, "listTasks")({ path: { channelId: "c1" } });

    expect(page.body).toEqual({ items: tasks, nextSince: "2026-10-21T10:00:00Z", complete: false });

    canned.answerNext({ status: 200, body: { data: tasks, next_since: "2026-10-21T10:00:00Z" } });

    await expect(call(client, "listTasks")({ path: { channelId: "c1" } })).resolves.toMatchObject({
      ok: false,
      unexpected: true,
    });
  });

  test("a Link page without first or last relation, and its previous cursor", async () => {
    const client = await cannedClient(HEADER_PAGE_API, canned);

    canned.answerNext({
      status: 200,
      body: tasks,
      headers: {
        "x-total-count": "7",
        "x-more": "false",
        link: '</p?cursor=c1>; rel="prev"',
      },
    });

    const page = await call(client, "listTasks")({ path: { channelId: "c1" } });

    expect(page.body).toEqual({
      items: tasks,
      total: 7,
      more: false,
      previous: "/p?cursor=c1",
      previousCursor: "c1",
    });
  });

  test("a boolean header outside true and false makes the page unexpected", async () => {
    const client = await cannedClient(HEADER_PAGE_API, canned);

    canned.answerNext({
      status: 200,
      body: tasks,
      headers: { "x-total-count": "7", "x-more": "constructor" },
    });

    await expect(call(client, "listTasks")({ path: { channelId: "c1" } })).resolves.toMatchObject({
      ok: false,
      unexpected: true,
    });
  });

  test.each([
    {
      name: "a quoted title holding a comma",
      link: '</p?cursor=c2>; title="a, b"; rel="next"',
      facts: { next: "/p?cursor=c2", nextCursor: "c2" },
    },
    {
      name: "a quoted title holding a target",
      link: '</p?cursor=c2>; title="<a>"; rel="next"',
      facts: { next: "/p?cursor=c2", nextCursor: "c2" },
    },
    {
      name: "a quoted title holding a rel parameter",
      link: '</p?cursor=c1>; title="x;rel=next"; rel="prev", </p?cursor=c3>; rel="next"',
      facts: {
        previous: "/p?cursor=c1",
        previousCursor: "c1",
        next: "/p?cursor=c3",
        nextCursor: "c3",
      },
    },
    {
      name: "an uppercase relation type",
      link: '</p?cursor=c2>; rel="Next"',
      facts: { next: "/p?cursor=c2", nextCursor: "c2" },
    },
    {
      name: "a value with several relations",
      link: '</p?cursor=c4>; rel="next last", </p?cursor=c0>; rel=first',
      facts: {
        first: "/p?cursor=c0",
        next: "/p?cursor=c4",
        last: "/p?cursor=c4",
        nextCursor: "c4",
      },
    },
  ])("a Link header with $name", async ({ link, facts }) => {
    const client = await cannedClient(HEADER_PAGE_API, canned);

    canned.answerNext({
      status: 200,
      body: tasks,
      headers: { "x-total-count": "7", "x-more": "true", link },
    });

    const page = await call(client, "listTasks")({ path: { channelId: "c1" } });

    expect(page.body).toEqual({ items: tasks, total: 7, more: true, ...facts });
  });
});
