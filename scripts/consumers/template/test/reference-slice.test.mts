// The slice test every consumer runs: the generated fetch client calls each reference operation on the server
// the overlay starts, then the refusals the contract declares.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient } from "../generated/client/tasks/client.js";
import { createClient as createServiceClient } from "../generated/client/tasksService/client.js";
import {
  bearer,
  SERVICE_JWT,
  STRIPE_SECRET,
  stripeSignature,
  THROTTLE_RETRY_AFTER_MS,
  THROTTLED_USER_TOKEN,
  USER_TOKEN,
} from "./credentials.mjs";
import { startServer } from "./server.mjs";

// The reference declares its ids as UUIDs, so a server target refuses any other path id with a 400.
const CHANNEL_ID = "10000000-0000-4000-8000-000000000001";
const TASK_ID = "20000000-0000-4000-8000-000000000001";
const DRAFT_ID = "30000000-0000-4000-8000-000000000001";
const ASSIGNEE_ID = "00000000-0000-4000-8000-000000000003";
const CHANNEL = { channelId: CHANNEL_ID };
const TASK = { channelId: CHANNEL_ID, taskId: TASK_ID };
const SERVICE_TIMEOUT_MS = 5000;

let server: Awaited<ReturnType<typeof startServer>>;
let tasks: ReturnType<typeof createClient>;
let service: ReturnType<typeof createServiceClient>;

const user = { authorization: bearer(USER_TOKEN) };

beforeAll(async () => {
  server = await startServer();
  tasks = createClient({ baseUrl: server.baseUrl });
  service = createServiceClient({ baseUrl: server.baseUrl });
});

afterAll(async () => {
  await server?.close();
});

describe("reference slice answers", () => {
  test("every operation once with success", async () => {
    const event = { id: "evt_1", type: "invoice.paid", data: {} };
    const expectations = [
      [await tasks.health(), 200, {}],
      [await tasks.listChannels({ headers: user }), 200, {}],
      [await tasks.getChannel({ path: CHANNEL, headers: user }), 200, { channelId: CHANNEL_ID }],
      [await tasks.listTasks({ path: CHANNEL, query: { limit: 10 }, headers: user }), 200, {}],
      [
        await tasks.createTask({
          path: CHANNEL,
          headers: user,
          body: { title: "Write the slice" },
        }),
        201,
        { title: "Write the slice" },
      ],
      [
        await tasks.getTasksBatch({ path: CHANNEL, headers: user, body: { ids: [TASK_ID] } }),
        200,
        {},
      ],
      [await tasks.searchTasks({ path: CHANNEL, headers: user, body: { text: "slice" } }), 200, {}],
      [await tasks.getTask({ path: TASK, headers: user }), 200, { taskId: TASK_ID }],
      [
        await tasks.updateTask({
          path: TASK,
          headers: user,
          body: { title: "Done", expectedVersion: 1 },
        }),
        200,
        { title: "Done" },
      ],
      [
        await tasks.archiveTask({
          path: TASK,
          headers: user,
          body: { reason: "finished", expectedVersion: 1 },
        }),
        200,
        { taskId: TASK_ID, state: "archived" },
      ],
      [
        await tasks.assignTask({ path: TASK, headers: user, body: { userId: ASSIGNEE_ID } }),
        200,
        { taskId: TASK_ID },
      ],
      [
        await tasks.purgeTask({ path: TASK, headers: user, body: { reauthToken: "reauth" } }),
        204,
        {},
      ],
      [
        await tasks.getDraft({ path: { draftId: DRAFT_ID }, headers: user }),
        200,
        { draftId: DRAFT_ID },
      ],
      [
        await tasks.deleteDraft({ path: { draftId: DRAFT_ID }, headers: user }),
        200,
        { draftId: DRAFT_ID },
      ],
      [await tasks.getPreferences({ headers: user }), 200, { locale: "en" }],
      [
        await tasks.updatePreferences({ headers: user, body: { digest: true } }),
        200,
        { digest: true },
      ],
      [
        await tasks.payments({
          headers: { "stripe-signature": stripeSignature(event) },
          body: event,
        }),
        204,
        {},
      ],
      [
        await service.getTask(
          { path: TASK, headers: { authorization: bearer(SERVICE_JWT) } },
          { timeoutMs: SERVICE_TIMEOUT_MS },
        ),
        200,
        { taskId: TASK_ID },
      ],
    ] as const;

    // The declared status and, where the handler echoes its input, that member of the body.
    for (const [answer, status, echoed] of expectations) {
      expect(answer).toMatchObject({ ok: true, status });

      if (Object.keys(echoed).length > 0) expect(answer).toMatchObject({ body: echoed });
    }
  });

  test("401 without credentials", async () => {
    await expect(tasks.getTask({ path: TASK })).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: "api.unauthenticated",
    });
  });

  test("400 for an empty title on create", async () => {
    const answer = await tasks.createTask({ path: CHANNEL, headers: user, body: { title: "" } });

    expect(answer).toMatchObject({ ok: false, status: 400, code: "api.schema_invalid" });
  });

  test("401 for a bad signature on payments", async () => {
    const event = { id: "evt_2", type: "invoice.paid", data: {} };
    const signedWithAnotherSecret = stripeSignature(event, `${STRIPE_SECRET}_other`);

    await expect(
      tasks.payments({ headers: { "stripe-signature": signedWithAnotherSecret }, body: event }),
    ).resolves.toMatchObject({ ok: false, status: 401, code: "api.unauthenticated" });
  });

  test("an idempotent replay answers the same body with the replay flag", async () => {
    const request = {
      path: CHANNEL,
      headers: { ...user, "idempotency-key": crypto.randomUUID() },
      body: { title: "Only once" },
    };
    const first = await tasks.createTask(request);
    const second = await tasks.createTask(request);

    expect(first).toMatchObject({ ok: true, status: 201, replayed: false });
    expect(second).toMatchObject({
      ok: true,
      status: 201,
      replayed: true,
      body: first.ok ? first.body : undefined,
    });
  });

  test("422 for an idempotency key reused with another body", async () => {
    const headers = { ...user, "idempotency-key": crypto.randomUUID() };

    await tasks.createTask({ path: CHANNEL, headers, body: { title: "First body" } });
    const reused = await tasks.createTask({
      path: CHANNEL,
      headers,
      body: { title: "Other body" },
    });

    expect(reused).toMatchObject({ ok: false, status: 422, code: "api.idempotency_key_reused" });
  });

  test("404 in the api format for a wrong method on a tasks path", async () => {
    const answer = await fetch(`${server.baseUrl}/v1/channels/${CHANNEL_ID}/tasks/${TASK_ID}`, {
      method: "PUT",
      headers: user,
    });

    expect(answer.status).toBe(404);
    expect(answer.headers.get("content-type")).toContain("application/problem+json");
    await expect(answer.json()).resolves.toMatchObject({ code: "api.not_found" });
  });

  test("404 in the api format for a wrong method on a tasksService path", async () => {
    const answer = await fetch(
      `${server.baseUrl}/internal/v1/channels/${CHANNEL_ID}/tasks/${TASK_ID}`,
      { method: "PUT", headers: { authorization: bearer(SERVICE_JWT) } },
    );

    expect(answer.status).toBe(404);
    expect(answer.headers.get("content-type")).toContain("application/problem+json");
    await expect(answer.json()).resolves.toMatchObject({ code: "api.not_found" });
  });

  test("429 with retryAfterMs", async () => {
    const answer = await tasks.createTask({
      path: CHANNEL,
      headers: { authorization: bearer(THROTTLED_USER_TOKEN) },
      body: { title: "Too many" },
    });

    expect(answer).toMatchObject({
      ok: false,
      status: 429,
      code: "api.rate_limited",
      params: { retryAfterMs: THROTTLE_RETRY_AFTER_MS },
    });
  });
});
