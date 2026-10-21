// The generated TanStack Query hooks in a browser page, against the real server through the same-origin proxy
// (ADR 0021 "The end-to-end proof"): tests 1 to 8, each through the generated client and hooks.
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { render, renderHook } from "vitest-browser-react";
import { createClient } from "../../generated/client/tasks/index.js";
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

const LIST_REQUEST = { path: { channelId: GENERAL_CHANNEL_ID } };
const IDEMPOTENCY_HEADER = "idempotency-key";
const QUIET_MS = 300;

interface SentRequest {
  readonly url: string;
  readonly method: string;
  readonly idempotencyKey: string | null;
}

// A fetch that records each request it sends to the server.
function recordingFetch(): { readonly send: typeof fetch; readonly sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const send: typeof fetch = (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method ?? "GET",
      idempotencyKey: new Headers(init?.headers).get(IDEMPOTENCY_HEADER),
    });

    return fetch(input, init);
  };

  return { send, sent };
}

function listRequests(sent: readonly SentRequest[]): SentRequest[] {
  return sent.filter((request) => request.method === "GET" && request.url.includes("/tasks"));
}

function clientFor(token: string, send: typeof fetch = fetch) {
  return createClient({
    baseUrl: window.location.origin,
    headers: { authorization: `Bearer ${token}` },
    fetch: send,
  });
}

function providerOf(queryClient: QueryClient) {
  return function Provider(props: { readonly children?: ReactNode }): ReactNode {
    return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>;
  };
}

function quietQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function scriptedPage(titles: readonly string[], nextCursor?: string) {
  return {
    status: 200,
    body: {
      items: titles.map((title, index) => ({
        taskId: `30000000-0000-4000-8000-00000000000${index}`,
        title,
        state: "open",
        version: 1,
        createdAt: "2026-10-18T09:00:00.000Z",
      })),
      ...(nextCursor === undefined ? {} : { nextCursor }),
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("1: a list renders", async () => {
  await loadScript({});

  await render(<TaskList Tasks={tasksHooksFor(inject("userToken"))} />, {
    wrapper: providerOf(quietQueryClient()),
  });

  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
});

test("2: an infinite cursor list loads three pages and ends", async () => {
  const { send, sent } = recordingFetch();

  await loadScript({
    answers: { "tasks.listTasks": scriptedPage(["First page task"], "cursor-2") },
  });
  await render(<InfiniteTaskList Tasks={tasksHooksFor(inject("userToken"), send)} />, {
    wrapper: providerOf(quietQueryClient()),
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
  const Tasks = tasksHooksFor(inject("userToken"), send);

  await render(
    <>
      <TaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="Refresh the list" />
    </>,
    { wrapper: providerOf(quietQueryClient()) },
  );
  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
  expect(listRequests(sent)).toHaveLength(1);

  await page.getByRole("button", { name: "Create" }).click();
  await expect.element(page.getByText("Created Refresh the list")).toBeInTheDocument();

  expect(listRequests(sent)).toHaveLength(2);
});

test("3: under invalidate: off the list stays as it was after a create", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = createPlainTasksQueries(clientFor(inject("userToken"), send));
  const { result } = await renderHook(
    () => ({
      // Fresh for ever, so only an invalidation would send the list again.
      list: useQuery(Tasks.listTasksOptions(LIST_REQUEST, { staleTime: Number.POSITIVE_INFINITY })),
      create: useMutation(Tasks.createTaskMutationOptions()),
    }),
    { wrapper: providerOf(quietQueryClient()) },
  );

  await expect.poll(() => result.current.list.isSuccess).toBe(true);

  const created = await result.current.create.mutateAsync({
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
    {
      wrapper: providerOf(quietQueryClient()),
    },
  );
  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
});

test("5: an unmount aborts the request", async () => {
  await loadScript({});

  const signals: AbortSignal[] = [];
  const hanging: typeof fetch = (_input, init) => {
    const signal = init?.signal;

    if (signal === undefined || signal === null) throw new Error("the query sent no signal");

    signals.push(signal);

    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  };

  const view = await render(<TaskList Tasks={tasksHooksFor(inject("userToken"), hanging)} />, {
    wrapper: providerOf(quietQueryClient()),
  });

  await expect.poll(() => signals.length).toBe(1);
  await view.unmount();

  await expect.poll(() => signals[0]?.aborted).toBe(true);
});

test("6: a dropped first answer and one retry send one idempotency key, the second answer replayed", async () => {
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

  const Tasks = tasksHooksFor(inject("userToken"), dropFirstAnswer);
  const { result } = await renderHook(() => Tasks.useCreateTask({ retry: 1, retryDelay: 0 }), {
    wrapper: providerOf(quietQueryClient()),
  });

  const created = await result.current.mutateAsync({
    ...LIST_REQUEST,
    body: { title: "Write once" },
  });
  const keys = sent
    .filter((request) => request.method === "POST")
    .map((request) => request.idempotencyKey);

  expect(created.replayed).toBe(true);
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBeNull();
  expect(keys[1]).toBe(keys[0]);
});

test("7: caller options pass through: enabled, select and queryKey", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksHooksFor(inject("userToken"), send);
  const queryClient = quietQueryClient();
  const ownKey = ["my-own-key"];
  const { result } = await renderHook(
    () => ({
      disabled: Tasks.useListTasks(LIST_REQUEST, { enabled: false }),
      titles: Tasks.useListTasks(LIST_REQUEST, {
        queryKey: ownKey,
        select: (data) => data.body.items.map((task) => task.title),
      }),
    }),
    { wrapper: providerOf(queryClient) },
  );

  await expect.poll(() => result.current.titles.data).toEqual(["Write the slice test"]);
  expect(result.current.disabled.fetchStatus).toBe("idle");
  expect(listRequests(sent)).toHaveLength(1);
  expect(queryClient.getQueryData(ownKey)).toMatchObject({ ok: true, status: 200 });
  expect(queryClient.getQueryData(Tasks.keys.listTasks(LIST_REQUEST))).toBeUndefined();
});

test("8: errors: data returns declared errors as data, headers as a plain record", async () => {
  await loadScript({});

  const Tasks = createDataTasksHooks(clientFor(inject("throttledUserToken")));
  const { result } = await renderHook(() => Tasks.useCreateTask(), {
    wrapper: providerOf(quietQueryClient()),
  });

  const answer = await result.current.mutateAsync({
    ...LIST_REQUEST,
    body: { title: "One too many" },
  });

  if (answer.ok || answer.unexpected) throw new Error(`createTask answered ${answer.status}`);

  expect(answer.code).toBe("api.rate_limited");
  expect(answer.headers).not.toBeInstanceOf(Headers);
  expect(Object.keys(answer.headers)).toContain("content-type");
  expect(result.current.error).toBeNull();
});
