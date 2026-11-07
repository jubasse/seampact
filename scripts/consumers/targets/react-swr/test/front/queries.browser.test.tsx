// The generated SWR hooks in a browser page, against the real server through the same-origin proxy (ADR 0021 "The
// end-to-end proof"): tests 1 to 4, 7 and 8, each through the generated client and hooks. Test 5 is dropped (SWR
// passes no abort signal to a fetcher), test 6 too (`useSWRMutation` has no retry).
import type { ReactNode } from "react";
import useSWR, { type Cache, SWRConfig, unstable_serialize } from "swr";
import useSWRMutation from "swr/mutation";
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { render, renderHook } from "vitest-browser-react";
import { createTasksHooks as createDataTasksHooks } from "../../generated/queriesData/tasks/index.js";
import { createTasksQueries as createPlainTasksQueries } from "../../generated/queriesPlain/tasks/index.js";
import {
  CreateTask,
  GENERAL_CHANNEL_ID,
  InfiniteTaskList,
  TaskList,
  tasksHooksFor,
} from "../../src/front/app.js";
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

// A configuration with its own cache, no retry and no revalidation on focus or on a repeated key, so each test
// starts empty and counts only the requests it causes.
function providerOf(cache: Cache = new Map()) {
  return function Provider(props: { readonly children?: ReactNode }): ReactNode {
    return (
      <SWRConfig
        value={{
          provider: () => cache,
          dedupingInterval: 0,
          shouldRetryOnError: false,
          revalidateOnFocus: false,
        }}
      >
        {props.children}
      </SWRConfig>
    );
  };
}

test("1: a list renders", async () => {
  await loadScript({});

  await render(<TaskList Tasks={tasksHooksFor(inject("userToken"))} />, {
    wrapper: providerOf(),
  });

  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
});

test("2: an infinite cursor list loads three pages and ends", async () => {
  const { send, sent } = recordingFetch();

  await loadScript({
    answers: { "tasks.listTasks": scriptedPage(["First page task"], "cursor-2") },
  });
  // SWR reads the first page again when the list grows; the script would answer it with the next page's tasks.
  await render(
    <InfiniteTaskList
      Tasks={tasksHooksFor(inject("userToken"), send)}
      config={{ revalidateFirstPage: false }}
    />,
    { wrapper: providerOf() },
  );
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

test("3: a create refreshes the list and the infinite list of its resource", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksHooksFor(inject("userToken"), send);

  await render(
    <>
      <TaskList Tasks={Tasks} />
      <InfiniteTaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="Refresh the list" />
    </>,
    { wrapper: providerOf() },
  );
  await expect.poll(() => listRequests(sent)).toHaveLength(2);
  await expect.poll(() => page.getByText("Write the slice test").elements()).toHaveLength(2);

  await page.getByRole("button", { name: "Create" }).click();
  await expect.element(page.getByText("Created Refresh the list")).toBeInTheDocument();

  expect(listRequests(sent)).toHaveLength(4);
});

test("3: under invalidate: off the list stays as it was after a create", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = createPlainTasksQueries(clientFor(inject("userToken"), send));
  const list = Tasks.listTasksOptions(LIST_REQUEST);
  const create = Tasks.createTaskMutationOptions();
  const { result } = await renderHook(
    () => ({
      list: useSWR(list.key, list.fetcher),
      create: useSWRMutation(create.key, create.fetcher),
    }),
    { wrapper: providerOf() },
  );

  await expect.poll(() => result.current.list.data?.status).toBe(200);

  const created = await result.current.create.trigger({
    ...LIST_REQUEST,
    body: { title: "Stay stale" },
  });

  expect(created.status).toBe(201);
  await wait(QUIET_MS);
  expect(listRequests(sent)).toHaveLength(1);
});

test("4: a throttled user sees api.rate_limited with its retryAfterMs", async () => {
  await loadScript({});

  await render(
    <CreateTask Tasks={tasksHooksFor(inject("throttledUserToken"))} title="One too many" />,
    { wrapper: providerOf() },
  );
  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
});

test("7: caller options pass through: a null request sends nothing, the config applies, the cache holds the key", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksHooksFor(inject("userToken"), send);
  const cache: Cache = new Map();
  const successes: string[][] = [];
  const { result } = await renderHook(
    () => ({
      disabled: Tasks.useListTasks(null),
      titles: Tasks.useListTasks(LIST_REQUEST, {
        onSuccess: (data) => {
          successes.push(data.body.items.map((task) => task.title));
        },
      }),
    }),
    { wrapper: providerOf(cache) },
  );

  await expect.poll(() => successes).toEqual([["Write the slice test"]]);
  expect(result.current.disabled.isLoading).toBe(false);
  expect(result.current.disabled.data).toBeUndefined();
  expect(listRequests(sent)).toHaveLength(1);
  expect(cache.get(unstable_serialize(Tasks.keys.listTasks(LIST_REQUEST)))).toMatchObject({
    data: { ok: true, status: 200 },
  });
});

test("8: errors: data returns declared errors as data, headers as a plain record", async () => {
  await loadScript({});

  const Tasks = createDataTasksHooks(clientFor(inject("throttledUserToken")));
  const { result } = await renderHook(() => Tasks.useCreateTask(), { wrapper: providerOf() });

  const answer = await result.current.trigger({
    ...LIST_REQUEST,
    body: { title: "One too many" },
  });

  if (answer.ok || answer.unexpected) throw new Error(`createTask answered ${answer.status}`);

  expect(answer.code).toBe("api.rate_limited");
  expect(answer.headers).not.toBeInstanceOf(Headers);
  expect(Object.keys(answer.headers)).toContain("content-type");
  expect(result.current.error).toBeUndefined();
});
