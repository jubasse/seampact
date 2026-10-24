// The generated RTK Query api in a browser page, against the real server through the same-origin proxy (ADR 0021
// "The end-to-end proof"): tests 1 to 4, 7 and 8, each through the generated client and RTK's hooks. Test 5 is
// dropped (RTK's hooks unsubscribe on unmount and never abort a request), test 6 too (a mutation over
// `fakeBaseQuery` has no retry).
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { render, renderHook } from "vitest-browser-react";
import { ContractError } from "../../generated/client/tasks/index.js";
import { toContractError } from "../../generated/queries/tasks/index.js";
import { createTasksApi as createDataTasksApi } from "../../generated/queriesData/tasks/index.js";
import { createTasksApi as createPlainTasksApi } from "../../generated/queriesPlain/tasks/index.js";
import {
  CreateTask,
  GENERAL_CHANNEL_ID,
  InfiniteTaskList,
  storeFor,
  TaskList,
  tasksApiFor,
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

function providerOf(store: ReturnType<typeof storeFor>) {
  return function StoreProvider(props: { readonly children?: ReactNode }): ReactNode {
    return <Provider store={store}>{props.children}</Provider>;
  };
}

test("1: a list renders", async () => {
  await loadScript({});

  const Tasks = tasksApiFor(inject("userToken"));

  await render(<TaskList Tasks={Tasks} />, { wrapper: providerOf(storeFor(Tasks)) });

  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
});

test("2: an infinite cursor list loads three pages and ends", async () => {
  const { send, sent } = recordingFetch();
  const Tasks = tasksApiFor(inject("userToken"), send);

  await loadScript({
    answers: { "tasks.listTasks": scriptedPage(["First page task"], "cursor-2") },
  });
  await render(<InfiniteTaskList Tasks={Tasks} />, { wrapper: providerOf(storeFor(Tasks)) });
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
  const Tasks = tasksApiFor(inject("userToken"), send);

  await render(
    <>
      <TaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="Refresh the list" />
    </>,
    { wrapper: providerOf(storeFor(Tasks)) },
  );
  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
  expect(listRequests(sent)).toHaveLength(1);

  await page.getByRole("button", { name: "Create" }).click();
  await expect.element(page.getByText("Created Refresh the list")).toBeInTheDocument();

  await expect.poll(() => listRequests(sent)).toHaveLength(2);
});

test("3: under invalidate: off the list stays as it was after a create, through the api without hooks", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = createPlainTasksApi(clientFor(inject("userToken"), send));
  const store = storeFor(Tasks);
  const list = store.dispatch(Tasks.endpoints.listTasks.initiate(LIST_REQUEST));

  expect((await list).data?.status).toBe(200);

  const created = await store
    .dispatch(
      Tasks.endpoints.createTask.initiate({ ...LIST_REQUEST, body: { title: "Stay stale" } }),
    )
    .unwrap();

  expect(created.status).toBe(201);
  await wait(QUIET_MS);
  expect(listRequests(sent)).toHaveLength(1);
  list.unsubscribe();
});

test("4: a throttled user sees api.rate_limited with its retryAfterMs, and the failed write refreshes nothing", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksApiFor(inject("throttledUserToken"), send);

  await render(
    <>
      <TaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="One too many" />
    </>,
    { wrapper: providerOf(storeFor(Tasks)) },
  );
  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
  await wait(QUIET_MS);
  expect(listRequests(sent)).toHaveLength(1);
});

test("4: the store keeps the declared error as a plain value, which toContractError turns back", async () => {
  await loadScript({});

  const Tasks = tasksApiFor(inject("throttledUserToken"));
  const store = storeFor(Tasks);
  const outcome = await store.dispatch(
    Tasks.endpoints.createTask.initiate({ ...LIST_REQUEST, body: { title: "One too many" } }),
  );
  const error = outcome.error;

  if (error === undefined || !("kind" in error) || error.kind !== "contract") {
    throw new Error(`createTask did not fail with a contract error: ${JSON.stringify(error)}`);
  }

  expect(error).not.toBeInstanceOf(Error);
  expect(error.failure.headers).not.toBeInstanceOf(Headers);

  const thrown = toContractError(error);

  expect(thrown).toBeInstanceOf(ContractError);
  expect(thrown.operation).toBe("createTask");
});

test("7: caller options pass through: skip sends nothing, selectFromResult applies", async () => {
  await loadScript({});

  const { send, sent } = recordingFetch();
  const Tasks = tasksApiFor(inject("userToken"), send);
  const store = storeFor(Tasks);
  const { result } = await renderHook(
    () => ({
      skipped: Tasks.useListTasksQuery(LIST_REQUEST, { skip: true }),
      titles: Tasks.useListTasksQuery(LIST_REQUEST, {
        selectFromResult: ({ data }) => ({
          titles: data?.body.items.map((task) => task.title),
        }),
      }),
    }),
    { wrapper: providerOf(store) },
  );

  await expect.poll(() => result.current.titles.titles).toEqual(["Write the slice test"]);
  expect(result.current.skipped.isUninitialized).toBe(true);
  expect(listRequests(sent)).toHaveLength(1);
  expect(Tasks.endpoints.listTasks.select(LIST_REQUEST)(store.getState()).data).toMatchObject({
    ok: true,
    status: 200,
  });
});

test("8: errors: data returns declared errors as data, headers as a plain record", async () => {
  await loadScript({});

  const Tasks = createDataTasksApi(clientFor(inject("throttledUserToken")));
  const { result } = await renderHook(() => Tasks.useCreateTaskMutation(), {
    wrapper: providerOf(storeFor(Tasks)),
  });
  const [createTask] = result.current;

  const answer = await createTask({ ...LIST_REQUEST, body: { title: "One too many" } }).unwrap();

  if (answer.ok || answer.unexpected) throw new Error(`createTask answered ${answer.status}`);

  expect(answer.code).toBe("api.rate_limited");
  expect(answer.headers).not.toBeInstanceOf(Headers);
  expect(Object.keys(answer.headers)).toContain("content-type");
  await expect.poll(() => result.current[1].isSuccess).toBe(true);
  expect(result.current[1].error).toBeUndefined();
});
