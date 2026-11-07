// The cases both projects run: the generated fetch client against the generated MSW handlers, with no server. A
// declared example answers by default; an operation with no example fails, naming itself, until the test gives a
// reply; a per-test override answers a typed success or a typed error through the client.
import type { HttpHandler } from "msw";
import { expect, test } from "vitest";
import { createClient } from "../../generated/client/tasks/index.js";
import type { createMocks } from "../../generated/mocks/tasks/index.js";

const CHANNEL_ID = "10000000-0000-4000-8000-000000000001";
const TASK_ID = "6f1c2a4e-8b1d-4c3a-9f2e-1d5b7a9c0e42";
const SEARCH_TIMEOUT_MS = 2000;
const RETRY_AFTER_MS = 1500;
const INTERNAL_STATUS = 500;

const TASK = {
  taskId: TASK_ID,
  title: "Write the slice test",
  state: "open",
  createdAt: "2027-01-15T09:30:00Z",
  version: 1,
} as const;

/** The mocks a project starts its server or worker with, and how it adds a test's own handlers. */
export interface MockedApi {
  readonly mocks: ReturnType<typeof createMocks>;
  readonly baseUrl: string;
  use(...handlers: HttpHandler[]): void;
}

export function describeClientAgainstMocks(api: () => MockedApi): void {
  const client = () => createClient({ baseUrl: api().baseUrl });

  test("an operation with a contract example answers it by default", async () => {
    const found = await client().searchTasks(
      { path: { channelId: CHANNEL_ID }, body: { text: "brief" } },
      { timeoutMs: SEARCH_TIMEOUT_MS },
    );

    if (!found.ok) throw new Error(`searchTasks answered ${found.status}`);

    expect(found.body.items.map((task) => task.title)).toEqual(["Write the brief"]);
  });

  test("an operation with no example fails naming itself until the test gives it a reply", async () => {
    const unanswered = await client().getTask({ path: { channelId: CHANNEL_ID, taskId: TASK_ID } });

    expect(unanswered).toMatchObject({
      ok: false,
      unexpected: true,
      status: INTERNAL_STATUS,
      body: {
        message: expect.stringContaining(
          "'getTask' (GET /v1/channels/{channelId}/tasks/{taskId}) has no example",
        ),
      },
    });

    api().use(api().mocks.getTask.reply(200, TASK));

    const answered = await client().getTask({ path: { channelId: CHANNEL_ID, taskId: TASK_ID } });

    if (!answered.ok) throw new Error(`getTask answered ${answered.status}`);

    expect(answered.body.title).toBe(TASK.title);
  });

  test("a page reply reaches the client with its next cursor read from the Link header", async () => {
    api().use(api().mocks.listTasks.reply(200, { items: [TASK], nextCursor: "page-2" }));

    const page = await client().listTasks({ path: { channelId: CHANNEL_ID } });

    if (!page.ok) throw new Error(`listTasks answered ${page.status}`);

    expect([page.body.items.length, page.body.nextCursor, page.body.next]).toEqual([
      1,
      "page-2",
      "?cursor=page-2",
    ]);
  });

  test("a per-test error override returns the typed error through the client", async () => {
    api().use(api().mocks.createTask.error("api.rate_limited", { retryAfterMs: RETRY_AFTER_MS }));

    const created = await client().createTask({
      path: { channelId: CHANNEL_ID },
      body: { title: "Throttled" },
    });

    if (created.ok || created.unexpected || created.code !== "api.rate_limited") {
      throw new Error(`createTask answered ${created.status}`);
    }

    expect([created.status, created.code, created.params.retryAfterMs]).toEqual([
      429,
      "api.rate_limited",
      RETRY_AFTER_MS,
    ]);
    expect(created.headers.get("retry-after")).toBe("2");
  });

  test("a resolver reads the request's path params and answers a declared error", async () => {
    api().use(
      api().mocks.getTask.resolve(({ params }) =>
        params.taskId === TASK_ID
          ? { status: 200, body: TASK }
          : { status: 404, code: "api.not_found" },
      ),
    );

    const missing = await client().getTask({ path: { channelId: CHANNEL_ID, taskId: CHANNEL_ID } });

    expect(missing).toMatchObject({
      ok: false,
      unexpected: false,
      status: 404,
      code: "api.not_found",
    });
  });
}
