// The generated Angular service in a browser page, against the real server through the same-origin proxy (ADR 0021
// "The end-to-end proof", "Angular"): tests 1 and 3 to 8, each through the generated client, sent by the app's
// HttpClient, and the service's readers and mutations. Test 2 is dropped: plain fetch has no infinite reader. The JIT
// compiler loads first: Angular's partially compiled packages need it as they load.
import "@angular/compiler";
import {
  HttpErrorResponse,
  type HttpInterceptorFn,
  HttpResponse,
  provideHttpClient,
  withInterceptors,
} from "@angular/common/http";
import { inject as angularInject, PLATFORM_ID, signal } from "@angular/core";
import { Observable, switchMap, throwError } from "rxjs";
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { TasksApi } from "../../generated/queries/tasks/index.js";
import {
  TasksApi as DataTasksApi,
  provideTasksApi as provideDataTasksApi,
} from "../../generated/queriesData/tasks/index.js";
import { createTasksQueries as createPlainTasksQueries } from "../../generated/queriesPlain/tasks/index.js";
import {
  appProviders,
  bearerToken,
  CreateTask,
  GENERAL_CHANNEL_ID,
  TaskList,
  TasksPage,
} from "../../src/front/app.mjs";
import { mount, runInApplication } from "./components.mjs";
import { loadScript } from "./control.mjs";
import "./provided.mjs";
import { clientFor, QUIET_MS, scriptedPage, wait } from "./requests.mjs";

const LIST_REQUEST = { path: { channelId: GENERAL_CHANNEL_ID } };
const OTHER_CHANNEL_ID = "10000000-0000-4000-8000-000000000002";
const IDEMPOTENCY_HEADER = "idempotency-key";

interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly idempotencyKey: string | null;
}

// An app interceptor that records each request the HttpClient sends.
function recordingInterceptor(): {
  readonly interceptor: HttpInterceptorFn;
  readonly seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  const interceptor: HttpInterceptorFn = (request, next) => {
    seen.push({
      method: request.method,
      url: request.url,
      idempotencyKey: request.headers.get(IDEMPOTENCY_HEADER),
    });

    return next(request);
  };

  return { interceptor, seen };
}

// An app interceptor that never answers and records, per request, whether it was cancelled.
function hangingInterceptor(): {
  readonly interceptor: HttpInterceptorFn;
  readonly cancelled: boolean[];
} {
  const cancelled: boolean[] = [];
  const interceptor: HttpInterceptorFn = () =>
    new Observable(() => {
      const index = cancelled.push(false) - 1;

      return () => {
        cancelled[index] = true;
      };
    });

  return { interceptor, cancelled };
}

function injectApi(): TasksApi {
  return angularInject(TasksApi);
}

function listReads(seen: readonly SeenRequest[]): SeenRequest[] {
  return seen.filter((request) => request.method === "GET" && request.url.includes("/tasks"));
}

test("1: a list renders, the token sent by an app interceptor", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  const view = await mount(TaskList, appProviders(inject("userToken"), [interceptor]));

  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
  expect(listReads(seen)).toHaveLength(1);
  view.unmount();
});

test("1: without the service the fetcher alone reads the list, headers as a plain record", async () => {
  await loadScript({});

  const Tasks = createPlainTasksQueries(clientFor(inject("userToken")));
  const list = await Tasks.listTasksOptions(LIST_REQUEST).fetcher(new AbortController().signal);

  expect(list.body.items.map((task) => task.title)).toEqual(["Write the slice test"]);
  expect(list.headers).not.toBeInstanceOf(Headers);
});

test("3: a create does not refresh the list by itself; refetch reads it again", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  const view = await mount(TasksPage, appProviders(inject("userToken"), [interceptor]));

  await expect.element(page.getByText("Write the slice test")).toBeInTheDocument();
  await page.getByRole("button", { name: "Create" }).click();
  await expect.element(page.getByText("Created A new task")).toBeInTheDocument();
  await loadScript({ answers: { "tasks.listTasks": scriptedPage(["Read again"]) } });
  await wait(QUIET_MS);

  expect(listReads(seen)).toHaveLength(1);
  await expect.element(page.getByText("Read again")).not.toBeInTheDocument();

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.element(page.getByText("Read again")).toBeInTheDocument();
  expect(listReads(seen)).toHaveLength(2);
  view.unmount();
});

test("4: a throttled user sees api.rate_limited with its retryAfterMs", async () => {
  await loadScript({});

  const view = await mount(CreateTask, appProviders(inject("throttledUserToken")), {
    title: "One too many",
  });

  await page.getByRole("button", { name: "Create" }).click();

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
  view.unmount();
});

test("5: destroying the component aborts the read", async () => {
  await loadScript({});

  const { interceptor, cancelled } = hangingInterceptor();
  const view = await mount(TaskList, appProviders(inject("userToken"), [interceptor]));

  await expect.poll(() => cancelled.length).toBe(1);
  view.unmount();

  await expect.poll(() => cancelled[0]).toBe(true);
});

test("5: a changed signal input aborts the previous read and sends the new one", async () => {
  await loadScript({});

  const { interceptor, cancelled } = hangingInterceptor();
  const view = await mount(TaskList, appProviders(inject("userToken"), [interceptor]));

  await expect.poll(() => cancelled.length).toBe(1);
  view.component.setInput("channelId", OTHER_CHANNEL_ID);

  await expect.poll(() => cancelled.length).toBe(2);
  expect(cancelled).toEqual([true, false]);
  view.unmount();
});

test("5: refetch after the injector is destroyed sends nothing", async () => {
  await loadScript({});

  const { interceptor, cancelled } = hangingInterceptor();
  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken"), [interceptor]),
    () => injectApi().listTasks(() => LIST_REQUEST),
  );

  await expect.poll(() => cancelled.length).toBe(1);
  unmount();
  result.refetch();
  await wait(QUIET_MS);

  expect(cancelled).toHaveLength(1);
});

test("5: on the server a reader sends nothing unless given a transferId", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  const serverProviders = [
    ...appProviders(inject("userToken"), [interceptor]),
    { provide: PLATFORM_ID, useValue: "server" },
  ];
  const { result, unmount } = await runInApplication(serverProviders, () => ({
    browserOnly: injectApi().listTasks(() => LIST_REQUEST),
    transferred: injectApi().listTasks(() => LIST_REQUEST, { transferId: "general-tasks" }),
  }));

  await expect.poll(() => result.transferred.data()?.body.items.length).toBe(1);
  await wait(QUIET_MS);

  expect(listReads(seen)).toHaveLength(1);
  expect(result.browserOnly.data()).toBeUndefined();
  expect(result.browserOnly.isLoading()).toBe(false);
  unmount();
});

test("6: a dropped first answer and one retry send one idempotency key, the second answer replayed", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  let dropped = false;
  // The answer reaches the app as a request that reached no server, once.
  const dropFirstAnswer: HttpInterceptorFn = (request, next) =>
    next(request).pipe(
      switchMap((event) => {
        if (dropped || !(event instanceof HttpResponse)) return [event];

        dropped = true;

        return throwError(() => new HttpErrorResponse({ status: 0, url: request.url }));
      }),
    );
  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken"), [interceptor, dropFirstAnswer]),
    () => injectApi().createTask({ retry: 1 }),
  );

  const created = await result.mutate({ ...LIST_REQUEST, body: { title: "Write once" } });
  const keys = seen
    .filter((request) => request.method === "POST")
    .map((request) => request.idempotencyKey);

  expect(created.data?.replayed).toBe(true);
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBeNull();
  expect(keys[1]).toBe(keys[0]);
  unmount();
});

test("6: each mutate resolves with its own result and key; the signals show the latest call", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken"), [interceptor]),
    () => injectApi().createTask(),
  );

  const [first, second] = await Promise.all([
    result.mutate({ ...LIST_REQUEST, body: { title: "First" } }),
    result.mutate({ ...LIST_REQUEST, body: { title: "Second" } }),
  ]);
  const keys = seen
    .filter((request) => request.method === "POST")
    .map((request) => request.idempotencyKey);

  expect(first.data?.body.title).toBe("First");
  expect(second.data?.body.title).toBe("Second");
  expect(new Set(keys).size).toBe(2);
  expect(result.data()?.body.title).toBe("Second");
  unmount();
});

test("7: caller options pass through: a null request sends nothing, an equal request reads once, call.signal aborts", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  const request = signal({ path: { channelId: GENERAL_CHANNEL_ID } });
  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken"), [interceptor]),
    () => ({
      skipped: injectApi().listTasks(() => null),
      list: injectApi().listTasks(request),
    }),
  );

  await expect.poll(() => result.list.data()?.body.items.length).toBe(1);
  request.set({ path: { channelId: GENERAL_CHANNEL_ID } });
  await wait(QUIET_MS);

  expect(result.skipped.data()).toBeUndefined();
  expect(result.skipped.isLoading()).toBe(false);
  expect(listReads(seen)).toHaveLength(1);
  unmount();

  const hanging = hangingInterceptor();
  const caller = new AbortController();
  const aborted = await runInApplication(
    appProviders(inject("userToken"), [hanging.interceptor]),
    () => injectApi().listTasks(() => LIST_REQUEST, { call: { signal: caller.signal } }),
  );

  await expect.poll(() => hanging.cancelled.length).toBe(1);
  caller.abort();

  await expect.poll(() => hanging.cancelled[0]).toBe(true);
  await expect.poll(() => aborted.result.error()).toBeInstanceOf(Error);
  aborted.unmount();
});

test("8: errors: data returns declared errors as data, headers as a plain record", async () => {
  await loadScript({});

  const { result, unmount } = await runInApplication(
    [
      provideHttpClient(withInterceptors([bearerToken(inject("throttledUserToken"))])),
      provideDataTasksApi({ baseUrl: window.location.origin }),
    ],
    () => angularInject(DataTasksApi).createTask(),
  );

  const { data: answer } = await result.mutate({
    ...LIST_REQUEST,
    body: { title: "One too many" },
  });

  if (answer === undefined || answer.ok || answer.unexpected) {
    throw new Error(`createTask answered ${JSON.stringify(answer)}`);
  }

  expect(answer.code).toBe("api.rate_limited");
  expect(answer.headers).not.toBeInstanceOf(Headers);
  expect(Object.keys(answer.headers)).toContain("content-type");
  expect(result.error()).toBeUndefined();
  unmount();
});
