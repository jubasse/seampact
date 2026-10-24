// The generated plain fetch hooks in a browser page, against the real server through the same-origin proxy
// (ADR 0021 "The end-to-end proof", "Plain fetch"): tests 1 and 3 to 8, each through the generated client and hooks.
// Test 2 is dropped: plain fetch has no infinite hook.
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { render, renderHook } from "vitest-browser-react";
import { createTasksHooks as createDataTasksHooks } from "../../generated/queriesData/tasks/index.js";
import { createTasksQueries as createPlainTasksQueries } from "../../generated/queriesPlain/tasks/index.js";
import { CreateTask, GENERAL_CHANNEL_ID, TaskList, tasksHooksFor } from "../../src/front/app.js";
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

// A fetch that never answers and records the signal of each request it holds.
function hangingFetch(): { readonly send: typeof fetch; readonly signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const send: typeof fetch = (_input, init) => {
    const signal = init?.signal;

    if (signal === undefined || signal === null) throw new Error("the query sent no signal");

    signals.push(signal);

    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  };

  return { send, signals };
}

test("1: a list renders", async () => {
  await loadScript({});

  await render(<TaskList Tasks={tasksHooksFor(inject("userToken"))} />);

  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
});

test("1: without hooks the fetcher alone reads the list, headers as a plain record", async () => {
  await loadScript({});

  const Tasks = createPlainTasksQueries(clientFor(inject("userToken")));
  const list = await Tasks.listTasksOptions(LIST_REQUEST).fetcher(new AbortController().signal);

  expect(list.body.items.map((task) => task.title)).toEqual(["Write the slice test"]);
  expect(list.headers).not.toBeInstanceOf(Headers);
});

test("3: a create does not refresh the list by itself; refetch reads it again", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksHooksFor(inject("userToken"), send);

  await render(
    <>
      <TaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="Refresh by hand" />
    </>,
  );
  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();

  await page.getByRole("button", { name: "Create" }).click();
  await expect.element(page.getByText("Created Refresh by hand")).toBeInTheDocument();
  await loadScript({ answers: { "tasks.listTasks": scriptedPage(["Read again"]) } });
  await wait(QUIET_MS);

  expect(listRequests(sent)).toHaveLength(1);
  await expect.element(page.getByText("Read again")).not.toBeInTheDocument();

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.element(page.getByText("Read again")).toBeInTheDocument();
  expect(listRequests(sent)).toHaveLength(2);
});

test("4: a throttled user sees api.rate_limited with its retryAfterMs", async () => {
  await loadScript({});

  await render(
    <CreateTask Tasks={tasksHooksFor(inject("throttledUserToken"))} title="One too many" />,
  );
  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
});

test("5: an unmount aborts the request", async () => {
  await loadScript({});

  const { send, signals } = hangingFetch();
  const view = await render(<TaskList Tasks={tasksHooksFor(inject("userToken"), send)} />);

  await expect.poll(() => signals.length).toBe(1);
  await view.unmount();

  await expect.poll(() => signals[0]?.aborted).toBe(true);
});

test("5: a request change aborts the previous read and sends the new one", async () => {
  await loadScript({});

  const { send, signals } = hangingFetch();
  const Tasks = tasksHooksFor(inject("userToken"), send);
  const view = await render(<TaskList Tasks={Tasks} />);

  await expect.poll(() => signals.length).toBe(1);
  await view.rerender(<TaskList Tasks={Tasks} channelId={OTHER_CHANNEL_ID} />);

  await expect.poll(() => signals.length).toBe(2);
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[1]?.aborted).toBe(false);
});

test("6: a dropped first answer and one retry send one idempotency key, the second answer replayed, hooks built in render", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  let dropped = false;
  const dropFirstAnswer: typeof fetch = async (input, init) => {
    const response = await send(input, init);

    if (dropped) return response;

    dropped = true;
    await response.body?.cancel();

    throw new TypeError("The first answer was dropped on its way back.");
  };

  // The hooks built in render: the re-render of the first attempt must not change the key of its retry.
  const { result } = await renderHook(() =>
    tasksHooksFor(inject("userToken"), dropFirstAnswer).useCreateTask({ retry: 1 }),
  );

  const created = await result.current.mutate({ ...LIST_REQUEST, body: { title: "Write once" } });
  const keys = sent
    .filter((request) => request.method === "POST")
    .map((request) => request.idempotencyKey);

  expect(created.data?.replayed).toBe(true);
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBeNull();
  expect(keys[1]).toBe(keys[0]);
});

test("7: caller options pass through: a null request sends nothing, an equal request reads once, call.signal aborts", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksHooksFor(inject("userToken"), send);
  const { result, rerender } = await renderHook(() => ({
    skipped: Tasks.useListTasks(null),
    list: Tasks.useListTasks({ path: { channelId: GENERAL_CHANNEL_ID } }),
  }));

  await expect.poll(() => result.current.list.data?.body.items.length).toBe(1);
  await rerender();
  await wait(QUIET_MS);

  expect(result.current.skipped).toMatchObject({ data: undefined, isLoading: false });
  expect(listRequests(sent)).toHaveLength(1);

  const hanging = hangingFetch();
  const caller = new AbortController();
  const Hanging = tasksHooksFor(inject("userToken"), hanging.send);
  const aborted = await renderHook(() =>
    Hanging.useListTasks(LIST_REQUEST, { call: { signal: caller.signal } }),
  );

  await expect.poll(() => hanging.signals.length).toBe(1);
  caller.abort();

  await expect.poll(() => hanging.signals[0]?.aborted).toBe(true);
  await expect.poll(() => aborted.result.current.error).toBeInstanceOf(Error);
});

test("8: errors: data returns declared errors as data, headers as a plain record", async () => {
  await loadScript({});

  const Tasks = createDataTasksHooks(clientFor(inject("throttledUserToken")));
  const { result } = await renderHook(() => Tasks.useCreateTask());

  const { data: answer } = await result.current.mutate({
    ...LIST_REQUEST,
    body: { title: "One too many" },
  });

  if (answer === undefined || answer.ok || answer.unexpected) {
    throw new Error(`createTask answered ${JSON.stringify(answer)}`);
  }

  expect(answer.code).toBe("api.rate_limited");
  expect(answer.headers).not.toBeInstanceOf(Headers);
  expect(Object.keys(answer.headers)).toContain("content-type");
  await expect.poll(() => result.current.error).toBeUndefined();
});
