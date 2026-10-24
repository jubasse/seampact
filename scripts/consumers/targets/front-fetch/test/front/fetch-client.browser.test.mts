// The generated fetch client in a browser page, against the real server through the same-origin proxy: a list
// with its Link header page fact, a create, a declared error, an abort, and the control routes of the same server.
// A client on a relative base URL also reaches it through a proxy that strips that prefix.
import { expect, inject, test } from "vitest";
import { createClient } from "../../generated/client/tasks/index.js";
import { loadScript, recordedHookCalls } from "./control.mjs";
import "./provided.mjs";

const CHANNEL_ID = "10000000-0000-4000-8000-000000000001";
const ABORT_ERROR = "AbortError";

function clientFor(token: string) {
  return createClient({
    baseUrl: window.location.origin,
    headers: { authorization: `Bearer ${token}` },
  });
}

test("the page reaches the server through its own origin", () => {
  expect(inject("serverBaseUrl")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(inject("serverBaseUrl")).not.toBe(window.location.origin);
});

test("a list renders its items and reads the next cursor from the Link header", async () => {
  await loadScript({});

  const page = await clientFor(inject("userToken")).listTasks({ path: { channelId: CHANNEL_ID } });

  if (!page.ok) throw new Error(`listTasks answered ${page.status}`);

  expect(page.body.items.map((task) => task.title)).toEqual(["Write the slice test"]);
  expect(page.body.nextCursor).toBe("page-2");
  expect(await recordedHookCalls()).toContainEqual(
    expect.objectContaining({ operation: expect.stringContaining("listTasks") }),
  );
});

test("a relative baseUrl behind a prefix-stripping proxy lists, follows the next page and writes", async () => {
  await loadScript({});

  const client = createClient({
    baseUrl: inject("strippedPrefix"),
    headers: { authorization: `Bearer ${inject("userToken")}` },
  });

  const firstPage = await client.listTasks({ path: { channelId: CHANNEL_ID } });

  if (!firstPage.ok) throw new Error(`listTasks answered ${firstPage.status}`);

  // The Link header holds a query-only reference, so it resolves against the URL the page called, prefix included.
  const { next } = firstPage.body;

  expect(next).toBe("?cursor=page-2");

  if (next === undefined) throw new Error("listTasks answered no next link");

  const calledUrl = `${window.location.origin}${inject("strippedPrefix")}/v1/channels/${CHANNEL_ID}/tasks`;
  const followed = await fetch(new URL(next, calledUrl), {
    headers: { authorization: `Bearer ${inject("userToken")}` },
  });

  expect(followed.status).toBe(200);

  const { nextCursor } = firstPage.body;

  if (nextCursor === undefined) throw new Error("listTasks answered no next cursor");

  const lastPage = await client.listTasks({
    path: { channelId: CHANNEL_ID },
    query: { cursor: nextCursor },
  });

  if (!lastPage.ok) throw new Error(`listTasks answered ${lastPage.status}`);

  expect(lastPage.body.nextCursor).toBeUndefined();

  const created = await client.createTask({
    path: { channelId: CHANNEL_ID },
    body: { title: "Behind the proxy" },
  });

  if (!created.ok) throw new Error(`createTask answered ${created.status}`);

  expect(created.status).toBe(201);
  expect(created.body.title).toBe("Behind the proxy");
});

test("a create answers the created task", async () => {
  const created = await clientFor(inject("userToken")).createTask({
    path: { channelId: CHANNEL_ID },
    body: { title: "Ship the front seam" },
  });

  if (!created.ok) throw new Error(`createTask answered ${created.status}`);

  expect(created.status).toBe(201);
  expect(created.body.title).toBe("Ship the front seam");
});

test("a throttled user gets the declared api.rate_limited error with its retryAfterMs", async () => {
  const created = await clientFor(inject("throttledUserToken")).createTask({
    path: { channelId: CHANNEL_ID },
    body: { title: "One too many" },
  });

  if (created.ok || created.unexpected) throw new Error(`createTask answered ${created.status}`);

  expect(created.code).toBe("api.rate_limited");

  if (created.code !== "api.rate_limited") return;

  expect(created.params.retryAfterMs).toBe(inject("throttleRetryAfterMs"));
});

test("an aborted call rejects with an AbortError", async () => {
  const controller = new AbortController();
  const call = clientFor(inject("userToken")).listTasks(
    { path: { channelId: CHANNEL_ID } },
    { signal: controller.signal },
  );

  controller.abort();

  await expect(call).rejects.toMatchObject({ name: ABORT_ERROR });
});
