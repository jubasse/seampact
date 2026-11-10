import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedFile } from "@seampact/codegen-core";
import { typesLinks } from "@seampact/codegen-core/node-server/test-support";
import { target as fetchTarget } from "@seampact/codegen-fetch";
import type { ContractIR } from "@seampact/spec/ir";
import axios from "axios";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { target } from "./index.js";

// The axios client is the fetch client over the app's axios instance: the files are the fetch client's, so what
// the fetch suite proves of generation holds here, and these cases run the generated client over real HTTP on
// axios, where only the transport differs.

const PROJECT = fileURLToPath(new URL("../.vitest/reference-over-axios/", import.meta.url));
const GOLDEN_ROOT = new URL("../../../../fixtures/golden/", import.meta.url);
const REFERENCE_GOLDEN = "reference";
const ADAPTER_PATH = "axios.ts";
// Each generated file names the target that wrote it in its header.
const AXIOS_PACKAGE = "@seampact/codegen-axios";
const FETCH_PACKAGE = "@seampact/codegen-fetch";
const TRACE_CONTEXT = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLOW_ANSWER_MILLISECONDS = 1500;
const SHORT_BUDGET_MILLISECONDS = 100;
const SETUP_TIMEOUT_MILLISECONDS = 60_000;

type Method = (request?: unknown, options?: unknown) => Promise<Record<string, unknown>>;

interface GeneratedModule {
  createClient(config: { baseUrl: string; fetch?: typeof fetch }): Record<string, Method>;
  fetchOfAxios(instance: ReturnType<typeof axios.create>): typeof fetch;
}

interface Answer {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly delayMs?: number;
}

interface Received {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

const TASK = {
  taskId: "t1",
  title: "Write",
  state: "open",
  version: 1,
  createdAt: "2026-10-18T09:00:00.000Z",
};

let server: Server;
let baseUrl: string;
let answer: Answer = { status: 200 };
const received: Received[] = [];
let tasks: Record<string, Method>;
let service: Record<string, Method>;
let serviceWrites: Record<string, Method>;
let paging: Record<string, Method>;
let splitSort: Record<string, Method>;
let laravel: Record<string, Method>;

function readIr(name: string, golden = REFERENCE_GOLDEN): ContractIR {
  return JSON.parse(readFileSync(new URL(`${golden}/${name}.ir.json`, GOLDEN_ROOT), "utf8"));
}

async function generate(
  provider: typeof target,
  ir: ContractIR,
): Promise<readonly GeneratedFile[]> {
  const outcome = await provider.generate({
    ir,
    options: {},
    links: typesLinks(ir),
    artefacts: new Set(["client"]),
  });

  if (outcome.status !== "generated") throw new Error(JSON.stringify(outcome));

  return outcome.files;
}

async function clientOf(name: string, golden = REFERENCE_GOLDEN): Promise<Record<string, Method>> {
  const directory = join(PROJECT, golden, name);

  for (const file of await generate(target, readIr(name, golden))) {
    mkdirSync(dirname(join(directory, file.path)), { recursive: true });
    writeFileSync(join(directory, file.path), file.contents);
  }

  const module: GeneratedModule = await import(join(directory, "index.ts"));

  return module.createClient({ baseUrl, fetch: module.fetchOfAxios(axios.create()) });
}

function startServer(): Promise<Server> {
  const listening = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });

      setTimeout(() => {
        response.writeHead(answer.status, {
          "content-type": "application/json",
          ...answer.headers,
        });
        response.end(answer.body === undefined ? undefined : JSON.stringify(answer.body));
      }, answer.delayMs ?? 0);
    });
  });

  return new Promise((resolve) => listening.listen(0, "127.0.0.1", () => resolve(listening)));
}

function portOf(listening: Server): number {
  const address = listening.address();

  if (address === null || typeof address === "string") throw new Error("the server has no port");

  return address.port;
}

const lastReceived = (): Received => {
  const last = received.at(-1);

  if (last === undefined) throw new Error("the server received no request");

  return last;
};

describe("the generated client over axios", () => {
  beforeAll(async () => {
    rmSync(PROJECT, { recursive: true, force: true });
    server = await startServer();
    baseUrl = `http://127.0.0.1:${portOf(server)}`;
    tasks = await clientOf("tasks");
    service = await clientOf("tasksService");
    serviceWrites = await clientOf("tasksServiceWrites");
    paging = await clientOf("tasksPaging");
    splitSort = await clientOf("tasksSplitSort");
    laravel = await clientOf("tasks", "pack-laravel");
  }, SETUP_TIMEOUT_MILLISECONDS);

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => {
    received.length = 0;
    answer = { status: 200 };
  });

  const call = (client: Record<string, Method>, name: string): Method => {
    const method = client[name];

    if (method === undefined) throw new Error(`the generated client has no '${name}'`);

    return method;
  };

  test.each([
    ["tasks", REFERENCE_GOLDEN],
    ["tasksPaging", REFERENCE_GOLDEN],
    ["tasksSplitSort", REFERENCE_GOLDEN],
    ["tasks", "pack-laravel"],
  ])(
    "the files are the fetch client's byte for byte, beside the adapter: %s of %s",
    async (name, golden) => {
      const ir = readIr(name, golden);
      const fetchFiles = new Map(
        (await generate(fetchTarget, ir)).map((f) => [f.path, f.contents]),
      );
      const axiosFiles = new Map((await generate(target, ir)).map((f) => [f.path, f.contents]));

      expect(axiosFiles.has(ADAPTER_PATH)).toBe(true);

      for (const [path, contents] of fetchFiles) {
        if (path === "index.ts") continue;

        expect(axiosFiles.get(path)?.replaceAll(AXIOS_PACKAGE, FETCH_PACKAGE), path).toBe(contents);
      }

      expect(target.describe(ir, {})).toEqual(fetchTarget.describe(ir, {}));
    },
  );

  test("generation is the same bytes on every run", async () => {
    const ir = readIr("tasks");

    expect(await generate(target, ir)).toEqual(await generate(target, ir));
  });

  test("a service call carries the deadline computed from its budget and the trace context it is given", async () => {
    answer = { status: 200, body: TASK };

    const request = {
      path: { channelId: "c1", taskId: "t1" },
      headers: { authorization: "Bearer s" },
    };

    await call(service, "getTask")(
      { ...request, headers: { ...request.headers, traceparent: TRACE_CONTEXT } },
      { timeoutMs: 2000 },
    );

    expect(lastReceived().headers.traceparent).toBe(TRACE_CONTEXT);
    expect(lastReceived().headers["x-deadline"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(lastReceived().headers.authorization).toBe("Bearer s");

    await call(service, "getTask")(request, { timeoutMs: 2000 });

    expect(lastReceived().headers.traceparent).toBeUndefined();
  });

  test("a route is sent with the identity headers it is given", async () => {
    answer = { status: 200, body: TASK };

    await call(
      tasks,
      "getTask",
    )({
      path: { channelId: "c1", taskId: "t1" },
      headers: { authorization: "Bearer user" },
    });

    expect(lastReceived().headers.authorization).toBe("Bearer user");
  });

  test("sends the actor-surface header it is given beside the service token", async () => {
    answer = { status: 201, body: TASK };

    const result = await call(serviceWrites, "createTask")(
      {
        path: { channelId: "c1" },
        headers: { authorization: "Bearer s", "x-actor-surface": "studio" },
        body: { title: "Relayed" },
      },
      { timeoutMs: 2000 },
    );

    expect(result).toMatchObject({ ok: true, status: 201 });
    expect(JSON.parse(lastReceived().body)).toEqual({ title: "Relayed" });
    expect(lastReceived().headers["x-actor-surface"]).toBe("studio");
    expect(lastReceived().headers["idempotency-key"]).toMatch(UUID);
  });

  test("each 2xx a route declares reaches the caller with its status, and another one is unexpected", async () => {
    const request = { path: { channelId: "c1" }, headers: {}, body: { title: "Write" } };

    answer = { status: 201, body: TASK };

    expect(await call(tasks, "createTask")(request)).toMatchObject({
      ok: true,
      status: 201,
      body: TASK,
    });

    answer = { status: 202, body: TASK };

    expect(await call(tasks, "createTask")(request)).toMatchObject({ ok: false, unexpected: true });
  });

  test("a DELETE answered 200 with a body gives that body to the caller", async () => {
    answer = { status: 200, body: { draftId: "d1", body: "Draft text" } };

    const result = await call(tasks, "deleteDraft")({ path: { draftId: "d1" }, headers: {} });

    expect(lastReceived().method).toBe("DELETE");
    expect(result).toMatchObject({ ok: true, status: 200, body: { draftId: "d1" } });
  });

  test("a declared error is a result on its code, never an axios throw", async () => {
    answer = { status: 404, body: { code: "api.not_found" } };

    expect(
      await call(tasks, "getTask")({ path: { channelId: "c1", taskId: "gone" }, headers: {} }),
    ).toMatchObject({ ok: false, unexpected: false, status: 404, code: "api.not_found" });
  });

  test("the query is written as the servers decode it: percent-encoded values, a list repeated or comma-separated", async () => {
    answer = { status: 200, body: { items: [] } };

    await call(
      tasks,
      "listTasks",
    )({
      path: { channelId: "c1" },
      query: {
        state: ["open", "done"],
        cursor: "a+b&c=d é",
        limit: 25,
        sort: ["-createdAt", "createdAt"],
      },
      headers: {},
    });

    const search = new URL(lastReceived().path, baseUrl).searchParams;

    expect(lastReceived().path).toContain("cursor=a%2Bb%26c%3Dd%20%C3%A9");
    expect(lastReceived().path).toContain("state=open&state=done");
    expect(search.get("cursor")).toBe("a+b&c=d é");
    expect(search.get("sort")).toBe("-createdAt,createdAt");
  });

  test("a page reads its items and the next cursor from the Link header", async () => {
    answer = {
      status: 200,
      body: [TASK],
      headers: { link: '</v1/channels/c1/tasks?cursor=cursor-2>; rel="next"' },
    };

    expect(
      await call(tasks, "listTasks")({ path: { channelId: "c1" }, headers: {} }),
    ).toMatchObject({ ok: true, status: 200, body: { items: [TASK], nextCursor: "cursor-2" } });
  });

  test("a batch read is a POST that carries no idempotency key and no CSRF header", async () => {
    answer = { status: 200, body: { a: { ...TASK, taskId: "a" } } };

    const result = await call(
      tasks,
      "getTasksBatch",
    )({
      path: { channelId: "c1" },
      headers: {},
      body: { ids: ["a"] },
    });
    const names = Object.keys(lastReceived().headers);

    expect(lastReceived().method).toBe("POST");
    expect(lastReceived().headers["content-type"]).toMatch(/^application\/json/);
    expect(JSON.parse(lastReceived().body)).toEqual({ ids: ["a"] });
    expect(result).toMatchObject({ ok: true, status: 200, body: { a: { taskId: "a" } } });
    expect(names).not.toContain("idempotency-key");
    expect(names.filter((name) => /csrf|xsrf/.test(name))).toEqual([]);
  });

  test("each write call generates its own idempotency key and a read carries none", async () => {
    const request = { path: { channelId: "c1" }, headers: {}, body: { title: "Write" } };

    answer = { status: 201, body: TASK };

    await call(tasks, "createTask")(request);

    expect(lastReceived().headers["content-type"]).toMatch(/^application\/json/);
    expect(JSON.parse(lastReceived().body)).toEqual(request.body);

    const first = lastReceived().headers["idempotency-key"];

    await call(tasks, "createTask")(request);

    expect(first).toMatch(UUID);
    expect(lastReceived().headers["idempotency-key"]).toMatch(UUID);
    expect(lastReceived().headers["idempotency-key"]).not.toBe(first);

    answer = { status: 200, body: TASK };
    await call(tasks, "getTask")({ path: { channelId: "c1", taskId: "t1" }, headers: {} });

    expect(lastReceived().headers["idempotency-key"]).toBeUndefined();
  });

  test("the derived 304 of an ETag is a result with no body", async () => {
    answer = { status: 304, headers: { etag: '"v1"' } };

    expect(
      await call(tasks, "getPreferences")({ headers: { "if-none-match": '"v1"' } }),
    ).toMatchObject({ ok: true, status: 304 });
    expect(lastReceived().headers["if-none-match"]).toBe('"v1"');
  });

  test("the replay flag is read from the response header", async () => {
    const request = { path: { channelId: "c1" }, headers: {}, body: { title: "Write" } };

    answer = { status: 201, body: TASK, headers: { "idempotency-replayed": "true" } };

    expect(await call(tasks, "createTask")(request)).toMatchObject({ ok: true, replayed: true });

    answer = { status: 201, body: TASK };

    expect(await call(tasks, "createTask")(request)).toMatchObject({ ok: true, replayed: false });
  });

  test("a changes feed sends its token, reads the next one and completeness, and a stale token as its 410", async () => {
    answer = {
      status: 200,
      body: { items: [TASK], next: "changes-2", complete: false, limit: 10 },
    };

    expect(await call(paging, "listChanges")({ query: { since: "changes-1" } })).toMatchObject({
      ok: true,
      body: { items: [TASK], nextSince: "changes-2", complete: false },
    });
    expect(new URL(lastReceived().path, baseUrl).searchParams.get("since")).toBe("changes-1");

    answer = { status: 410, body: { code: "api.cursor_too_old" } };

    expect(await call(paging, "listChanges")({ query: { since: "changes-0" } })).toMatchObject({
      ok: false,
      status: 410,
      code: "api.cursor_too_old",
    });
  });

  test("a Stripe list sends the cursor it pages after and reads its more flag", async () => {
    const cursor = "30000000-0000-4000-8000-000000000000";

    answer = { status: 200, body: { object: "list", data: [TASK], has_more: true, url: "/n" } };

    expect(await call(paging, "listNotes")({ query: { starting_after: cursor } })).toMatchObject({
      ok: true,
      body: { items: [TASK], more: true },
    });
    expect(new URL(lastReceived().path, baseUrl).searchParams.get("starting_after")).toBe(cursor);
  });

  test("GitHub pages send one sort key and its direction, and read the page links from the Link header", async () => {
    answer = {
      status: 200,
      body: [TASK],
      headers: {
        link: '</split-sort/v1/notes?page=2>; rel="next", </split-sort/v1/notes?page=3>; rel="last"',
      },
    };

    expect(
      await call(
        splitSort,
        "listNotes",
      )({ query: { page: 1, per_page: 100, sort: "created", direction: "desc" } }),
    ).toMatchObject({
      ok: true,
      body: {
        items: [TASK],
        next: "/split-sort/v1/notes?page=2",
        last: "/split-sort/v1/notes?page=3",
      },
    });
    expect(Object.fromEntries(new URL(lastReceived().path, baseUrl).searchParams)).toEqual({
      page: "1",
      per_page: "100",
      sort: "created",
      direction: "desc",
    });
  });

  test("pack-laravel: data-wrapped items and a length-aware page", async () => {
    answer = { status: 200, body: { data: { taskId: "t1", title: "Write" } } };

    expect(
      await call(laravel, "getTask")({ path: { channelId: "c1", taskId: "t1" } }),
    ).toMatchObject({ ok: true, body: { taskId: "t1", title: "Write" } });

    answer = {
      status: 200,
      body: {
        data: [TASK],
        links: { first: "/p1", last: "/p4", prev: "/p1", next: null },
        meta: { current_page: 2, from: 3, last_page: 4, path: "/v", per_page: 2, to: 4, total: 7 },
      },
    };

    const page = await call(
      laravel,
      "listTasks",
    )({ path: { channelId: "c1" }, query: { page: 2 } });

    expect(page.body).toMatchObject({
      items: [TASK],
      first: "/p1",
      last: "/p4",
      previous: "/p1",
      page: 2,
      totalPages: 4,
      total: 7,
    });
  });

  test("pack-laravel: a page-number request writes the style's page and limit names", async () => {
    answer = {
      status: 200,
      body: {
        data: [TASK],
        links: { first: "?page=1", last: "?page=1", prev: null, next: null },
        meta: { current_page: 1, from: 1, last_page: 1, path: "/v", per_page: 2, to: 2, total: 2 },
      },
    };

    await call(
      laravel,
      "listTasks",
    )({ path: { channelId: "c1" }, query: { page: 1, per_page: 2 } });

    expect(new URL(lastReceived().path, baseUrl).searchParams.toString()).toBe("page=1&per_page=2");
  });

  test("the pack-hal client is refused by name", async () => {
    const ir = readIr("tasks", "pack-hal");
    const outcome = await target.generate({
      ir,
      options: {},
      links: typesLinks(ir),
      artefacts: new Set(["client"]),
    });

    expect(outcome).toMatchObject({
      status: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({ code: "format.template.unsupported" }),
      ]),
    });
  });

  test("the pack-spring client is generated", async () => {
    const ir = readIr("tasks", "pack-spring");

    expect(await generate(target, ir)).not.toHaveLength(0);
  });

  test("the budget aborts a slow call with a TimeoutError", async () => {
    answer = { status: 200, body: TASK, delayMs: SLOW_ANSWER_MILLISECONDS };

    await expect(
      call(tasks, "getTask")(
        { path: { channelId: "c1", taskId: "t1" }, headers: {} },
        { timeoutMs: SHORT_BUDGET_MILLISECONDS },
      ),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
