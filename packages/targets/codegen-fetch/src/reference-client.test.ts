import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { GeneratedFile, Target } from "@seampact/codegen-core";
import type { ContractIR } from "@seampact/spec/ir";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { target as clientTarget } from "./index.js";

// The consumer layout of the run script, under the package's git-ignored `.vitest/`. Its `node_modules` links the
// workspace packages a consumer installs, so the stub server imports the runtime helpers by name; this package
// itself depends on none of them (ADR 0009 "Dependency rules").
const PROJECT = fileURLToPath(new URL("../.vitest/reference-client/", import.meta.url));
const REPOSITORY_ROOT = new URL("../../../../", import.meta.url);
const LINKED_PACKAGES = {
  "@seampact/codegen-ts": "packages/targets/codegen-ts",
  "@seampact/hooks": "packages/runtime/hooks",
  "@seampact/idempotency-memory": "packages/runtime/idempotency-memory",
  "@seampact/signed-webhooks": "packages/runtime/signed-webhooks",
};
const CONSUMERS = new URL("scripts/consumers/", REPOSITORY_ROOT);
const APIS = ["tasks", "tasksService"] as const;
const RESULT_CLIENT = "client";
const THROW_CLIENT = "clientThrow";
const PROBE_FILE = "probe.ts";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEADLINE_TOLERANCE_MS = 1000;

type Method = (request?: unknown, options?: unknown) => Promise<Record<string, unknown>>;

interface ClientModule {
  createClient(config: { baseUrl: string; fetch?: typeof fetch }): Record<string, Method>;
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
let isClientContractError: (error: unknown) => boolean;
let typesTarget: Target;

function readGoldenIr(name: string): ContractIR {
  return JSON.parse(
    readFileSync(new URL(`fixtures/golden/reference/${name}.ir.json`, REPOSITORY_ROOT), "utf8"),
  );
}

function writeFiles(directory: string, files: readonly GeneratedFile[]): string[] {
  return files.map((file) => {
    const path = join(PROJECT, directory, file.path);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.contents);

    return path;
  });
}

async function generateApi(api: string): Promise<string[]> {
  const ir = readGoldenIr(api);
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
  linkWorkspacePackages();

  typesTarget = (
    await importProjectModule<{ target: Target }>("node_modules/@seampact/codegen-ts/src/index.ts")
  ).target;

  const paths = (await Promise.all(APIS.map(generateApi))).flat();

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

  tasks = resultModule.createClient({ baseUrl: stub.baseUrl, ...config });
  service = serviceModule.createClient({ baseUrl: stub.baseUrl, ...config });
  throwing = throwModule.createClient({ baseUrl: stub.baseUrl, ...config });

  if (throwModule.isClientContractError === undefined) {
    throw new Error("the throw-style client exports no isClientContractError");
  }

  isClientContractError = throwModule.isClientContractError;
});

afterAll(async () => {
  await stub?.close();
  rmSync(PROJECT, { recursive: true, force: true });
});

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
    ).resolves.toMatchObject({ ok: true, status: 200, body: [{ taskId: "a" }, { taskId: "b" }] });
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
      query: { limit: 2, sort: ["-createdAt", "title"] },
      headers: user(),
    });

    expect(lastSent().url.pathname).toBe("/v1/channels/c%201/tasks");
    expect(lastSent().url.search).toBe("?limit=2&sort=-createdAt,title");
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
      params: { issues: [{ pointer: "/body/title" }] },
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
