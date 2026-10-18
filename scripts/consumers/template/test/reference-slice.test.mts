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

const CHANNEL = { channelId: "channel-1" };
const TASK = { channelId: "channel-1", taskId: "task-1" };
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
    const answers = [
      await tasks.health(),
      await tasks.listChannels({ headers: user }),
      await tasks.getChannel({ path: CHANNEL, headers: user }),
      await tasks.listTasks({ path: CHANNEL, query: { limit: 10 }, headers: user }),
      await tasks.createTask({ path: CHANNEL, headers: user, body: { title: "Write the slice" } }),
      await tasks.getTasksBatch({ path: CHANNEL, headers: user, body: { ids: ["task-1"] } }),
      await tasks.searchTasks({ path: CHANNEL, headers: user, body: { text: "slice" } }),
      await tasks.getTask({ path: TASK, headers: user }),
      await tasks.updateTask({
        path: TASK,
        headers: user,
        body: { title: "Done", expectedVersion: 1 },
      }),
      await tasks.archiveTask({
        path: TASK,
        headers: user,
        body: { reason: "finished", expectedVersion: 1 },
      }),
      await tasks.assignTask({ path: TASK, headers: user, body: { userId: "user-2" } }),
      await tasks.purgeTask({ path: TASK, headers: user, body: { reauthToken: "reauth" } }),
      await tasks.getDraft({ path: { draftId: "draft-1" }, headers: user }),
      await tasks.deleteDraft({ path: { draftId: "draft-1" }, headers: user }),
      await tasks.getPreferences({ headers: user }),
      await tasks.updatePreferences({ headers: user, body: { digest: true } }),
      await tasks.payments({
        headers: { "stripe-signature": stripeSignature(event) },
        body: event,
      }),
      await service.getTask(
        { path: TASK, headers: { authorization: bearer(SERVICE_JWT) } },
        { timeoutMs: SERVICE_TIMEOUT_MS },
      ),
    ];

    for (const answer of answers) expect(answer).toMatchObject({ ok: true });
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
