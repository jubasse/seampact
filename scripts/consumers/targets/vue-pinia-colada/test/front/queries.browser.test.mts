// The generated Pinia Colada composables in a browser page, against the real server through the same-origin proxy
// (ADR 0021 "The end-to-end proof"), each through the generated client and composables under the app's own Pinia.
import { PiniaColada, useMutation, useQuery, useQueryCache } from "@pinia/colada";
import { createPinia } from "pinia";
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-vue";
import { h, type Plugin, shallowRef } from "vue";
import { createTasksComposables as createDataTasksComposables } from "../../generated/queriesData/tasks/index.js";
import { createTasksQueries as createPlainTasksQueries } from "../../generated/queriesPlain/tasks/index.js";
import {
  CreateTask,
  GENERAL_CHANNEL_ID,
  InfiniteTaskList,
  TaskList,
  tasksComposablesFor,
} from "../../src/front/app.mjs";
import { renderComposable } from "./composables.mjs";
import { loadScript } from "./control.mjs";
import "./provided.mjs";
import {
  clientFor,
  listRequests,
  QUIET_MS,
  recordingFetch,
  scriptedPage,
  wait,
} from "./requests.mjs";

const LIST_REQUEST = { path: { channelId: GENERAL_CHANNEL_ID } };
const OTHER_CHANNEL_ID = "10000000-0000-4000-8000-000000000002";

// A fresh Pinia and Pinia Colada per test, so no cache entry outlives its test.
function coladaPlugins(): Plugin[] {
  return [createPinia(), PiniaColada];
}

test("1: a list renders", async () => {
  await loadScript({});

  await render(TaskList, {
    props: { Tasks: tasksComposablesFor(inject("userToken")) },
    global: { plugins: coladaPlugins() },
  });

  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
});

test("2: an infinite cursor list loads three pages and ends", async () => {
  const { send, sent } = recordingFetch();

  await loadScript({
    answers: { "tasks.listTasks": scriptedPage(["First page task"], "cursor-2") },
  });
  await render(InfiniteTaskList, {
    props: { Tasks: tasksComposablesFor(inject("userToken"), send) },
    global: { plugins: coladaPlugins() },
  });
  await expect.element(page.getByText("First page task")).toBeInTheDocument();

  await loadScript({
    answers: { "tasks.listTasks": scriptedPage(["Second page task"], "cursor-3") },
  });
  await page.getByRole("button", { name: "More" }).click();
  await expect.element(page.getByText("Second page task")).toBeInTheDocument();

  await loadScript({ answers: { "tasks.listTasks": scriptedPage(["Third page task"]) } });
  await page.getByRole("button", { name: "More" }).click();
  await expect.element(page.getByText("Third page task")).toBeInTheDocument();
  await expect.element(page.getByText("End of the list")).toBeInTheDocument();

  const cursors = listRequests(sent).map((request) =>
    new URL(request.url).searchParams.get("cursor"),
  );

  expect(cursors).toEqual([null, "cursor-2", "cursor-3"]);
  await expect.element(page.getByText("First page task")).toBeInTheDocument();
});

test("3: a create refreshes the list of its resource", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksComposablesFor(inject("userToken"), send);

  await render(
    () => [h(TaskList, { Tasks }), h(CreateTask, { Tasks, title: "Refresh the list" })],
    { global: { plugins: coladaPlugins() } },
  );
  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
  expect(listRequests(sent)).toHaveLength(1);

  await page.getByRole("button", { name: "Create" }).click();
  await expect.element(page.getByText("Created Refresh the list")).toBeInTheDocument();

  await expect.poll(() => listRequests(sent).length).toBe(2);
});

test("3: under invalidate: off the list stays as it was after a create", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = createPlainTasksQueries(clientFor(inject("userToken"), send));
  const { result } = await renderComposable(
    () => ({
      // Fresh for ever, so only an invalidation would send the list again.
      list: useQuery(Tasks.listTasksOptions(LIST_REQUEST, { staleTime: Number.POSITIVE_INFINITY })),
      create: useMutation(Tasks.createTaskMutationOptions()),
    }),
    coladaPlugins(),
  );

  await expect.poll(() => result.list.status.value).toBe("success");

  const created = await result.create.mutateAsync({
    ...LIST_REQUEST,
    body: { title: "Stay stale" },
  });

  expect(created.status).toBe(201);
  await wait(QUIET_MS);
  expect(listRequests(sent)).toHaveLength(1);
});

test("3: a create the server accepted resolves when the list refresh fails", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksComposablesFor(inject("userToken"), send);
  const { result } = await renderComposable(
    () => ({ list: Tasks.useListTasks(LIST_REQUEST), create: Tasks.useCreateTask() }),
    coladaPlugins(),
  );

  await expect.poll(() => result.list.status.value).toBe("success");
  await loadScript({ answers: { "tasks.listTasks": { throws: "list refresh failure" } } });

  const created = await result.create.mutateAsync({
    ...LIST_REQUEST,
    body: { title: "Accepted once" },
  });

  expect(created.body.title).toBe("Accepted once");
  expect(result.create.status.value).toBe("success");
  await expect.poll(() => result.list.status.value).toBe("error");
  expect(sent.filter((request) => request.method === "POST")).toHaveLength(1);
});

test("4: a throttled user sees api.rate_limited with its retryAfterMs", async () => {
  await loadScript({});

  await render(CreateTask, {
    props: { Tasks: tasksComposablesFor(inject("throttledUserToken")), title: "One too many" },
    global: { plugins: coladaPlugins() },
  });
  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
});

test("5: a request change reads the new request", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksComposablesFor(inject("userToken"), send);
  const request = shallowRef(LIST_REQUEST);

  await renderComposable(() => Tasks.useListTasks(request), coladaPlugins());

  await expect.poll(() => listRequests(sent)).toHaveLength(1);
  request.value = { path: { channelId: OTHER_CHANNEL_ID } };

  await expect.poll(() => listRequests(sent)).toHaveLength(2);
  expect(listRequests(sent)[1]?.url).toContain(OTHER_CHANNEL_ID);
});

test("6: each create sends its own idempotency key", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksComposablesFor(inject("userToken"), send);
  const { result } = await renderComposable(() => Tasks.useCreateTask(), coladaPlugins());

  await result.mutateAsync({ ...LIST_REQUEST, body: { title: "First write" } });
  await result.mutateAsync({ ...LIST_REQUEST, body: { title: "Second write" } });

  const keys = sent
    .filter((request) => request.method === "POST")
    .map((request) => request.idempotencyKey);

  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBeNull();
  expect(keys[1]).not.toBeNull();
  expect(keys[1]).not.toBe(keys[0]);
});

test("7: caller options pass through: enabled and key", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksComposablesFor(inject("userToken"), send);
  const ownKey = ["my-own-key"];
  const { result } = await renderComposable(
    () => ({
      disabled: Tasks.useListTasks(LIST_REQUEST, { enabled: false }),
      own: Tasks.useListTasks(LIST_REQUEST, { key: ownKey }),
      queryCache: useQueryCache(),
    }),
    coladaPlugins(),
  );

  await expect.poll(() => result.own.status.value).toBe("success");
  expect(result.disabled.asyncStatus.value).toBe("idle");
  expect(listRequests(sent)).toHaveLength(1);
  expect(result.queryCache.getQueryData(ownKey)).toMatchObject({ ok: true, status: 200 });
  expect(result.queryCache.getQueryData(Tasks.keys.listTasks(LIST_REQUEST))).toBeUndefined();
});

test("8: errors: data returns declared errors as data, headers as a plain record", async () => {
  await loadScript({});

  const Tasks = createDataTasksComposables(clientFor(inject("throttledUserToken")));
  const { result } = await renderComposable(() => Tasks.useCreateTask(), coladaPlugins());

  const answer = await result.mutateAsync({
    ...LIST_REQUEST,
    body: { title: "One too many" },
  });

  if (answer.ok || answer.unexpected) throw new Error(`createTask answered ${answer.status}`);

  expect(answer.code).toBe("api.rate_limited");
  expect(answer.headers).not.toBeInstanceOf(Headers);
  expect(Object.keys(answer.headers)).toContain("content-type");
  expect(result.error.value).toBeNull();
});
