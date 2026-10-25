// The generated Signal Store features in a browser page, against the real server through the same-origin proxy (ADR
// 0021 "The end-to-end proof", "Angular"): composed into the app's own store, each feature sends through the generated
// service and the app's HttpClient, and its call settles in the feature's slice. The JIT compiler loads first:
// Angular's partially compiled packages need it as they load.
import "@angular/compiler";
import {
  HttpErrorResponse,
  type HttpEvent,
  type HttpInterceptorFn,
  HttpResponse,
} from "@angular/common/http";
import { inject as angularInject, PLATFORM_ID } from "@angular/core";
import { signalStore } from "@ngrx/signals";
import { switchMap, throwError } from "rxjs";
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { isContractError, withListTasks } from "../../generated/queries/tasks/index.js";
import {
  appProviders,
  GENERAL_CHANNEL_ID,
  TaskBoard,
  TaskBoardStore,
} from "../../src/front/app.mjs";
import { mount, runInApplication } from "./components.mjs";
import { loadScript } from "./control.mjs";
import "./provided.mjs";
import { QUIET_MS, wait } from "./requests.mjs";

const LIST_REQUEST = { path: { channelId: GENERAL_CHANNEL_ID } };
const OTHER_LIST_REQUEST = { path: { channelId: "10000000-0000-4000-8000-000000000002" } };
const IDEMPOTENCY_HEADER = "idempotency-key";

interface SeenRequest {
  readonly method: string;
  readonly key: string | null;
}

// An app interceptor that records each request's method and idempotency key.
function recordingInterceptor(): {
  readonly interceptor: HttpInterceptorFn;
  readonly seen: SeenRequest[];
} {
  const seen: SeenRequest[] = [];
  const interceptor: HttpInterceptorFn = (request, next) => {
    seen.push({ method: request.method, key: request.headers.get(IDEMPOTENCY_HEADER) });

    return next(request);
  };

  return { interceptor, seen };
}

// A store whose list feature reads during server rendering too.
const ServerReadingStore = signalStore(withListTasks({ readOnServer: true }));

function injectStore() {
  return angularInject(TaskBoardStore);
}

// The task id of a created task's answer, which the client reads as text.
function createdTaskId(event: HttpEvent<unknown>): string | undefined {
  if (!(event instanceof HttpResponse) || typeof event.body !== "string") return undefined;

  const body: unknown = JSON.parse(event.body);

  return typeof body === "object" && body !== null && "taskId" in body
    ? String(body.taskId)
    : undefined;
}

test("a feature composed into the app's store loads the data into its slice", async () => {
  await loadScript({});

  const { result: store, unmount } = await runInApplication(
    appProviders(inject("userToken")),
    injectStore,
  );

  expect(store.listTasks().status).toBe("idle");

  const loading = store.sendListTasks(LIST_REQUEST);

  expect(store.listTasks()).toMatchObject({ status: "pending", request: LIST_REQUEST });

  const settled = await loading;

  expect(settled.status).toBe("success");
  expect(store.listTasks()).toEqual(settled);
  expect(store.titles()).toEqual(["Write the slice test"]);
  expect(store.channelId()).toBe(GENERAL_CHANNEL_ID);
  unmount();
});

test("a contract error lands typed in the slice, which the app shows", async () => {
  await loadScript({});

  const view = await mount(TaskBoard, appProviders(inject("throttledUserToken")));

  await page.getByRole("button", { name: "Create" }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
  view.unmount();

  const { result: store, unmount } = await runInApplication(
    appProviders(inject("throttledUserToken")),
    injectStore,
  );

  await store.sendCreateTask({ ...LIST_REQUEST, body: { title: "One too many" } });

  const { error } = store.createTask();

  expect(store.createTask().status).toBe("error");
  expect(isContractError(error) && !error.failure.unexpected && error.failure.code).toBe(
    "api.rate_limited",
  );
  unmount();
});

test("two requests of one operation both settle; the same request twice keeps the latest", async () => {
  await loadScript({});

  const { result: store, unmount } = await runInApplication(
    appProviders(inject("userToken")),
    injectStore,
  );

  const side = await Promise.all([
    store.sendListTasks(LIST_REQUEST),
    store.sendListTasks(OTHER_LIST_REQUEST),
  ]);

  expect(side.map((slice) => [slice.status, slice.request])).toEqual([
    ["success", LIST_REQUEST],
    ["success", OTHER_LIST_REQUEST],
  ]);
  expect(store.listTasks().request).toEqual(OTHER_LIST_REQUEST);

  const [superseded, latest] = await Promise.all([
    store.sendListTasks(LIST_REQUEST),
    store.sendListTasks({ ...LIST_REQUEST }),
  ]);

  expect(superseded.status).toBe("error");
  expect(superseded.error).toMatchObject({ name: "AbortError" });
  expect(latest.status).toBe("success");
  expect(store.listTasks()).toEqual(latest);
  unmount();
});

test("a write sent again with the key it gave runs once, the second answer replayed", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  let droppedTaskId: string | undefined;
  // The first answer reaches the app as a request that reached no server, once.
  const dropFirstAnswer: HttpInterceptorFn = (request, next) =>
    next(request).pipe(
      switchMap((event) => {
        const taskId = createdTaskId(event);

        if (droppedTaskId !== undefined || taskId === undefined) return [event];

        droppedTaskId = taskId;

        return throwError(() => new HttpErrorResponse({ status: 0, url: request.url }));
      }),
    );
  const { result: store, unmount } = await runInApplication(
    appProviders(inject("userToken"), [interceptor, dropFirstAnswer]),
    injectStore,
  );
  const request = { ...LIST_REQUEST, body: { title: "Write once" } };
  const idempotencyKey = crypto.randomUUID();

  const lost = await store.sendCreateTask(request, { idempotencyKey });
  const retried = await store.sendCreateTask(request, { idempotencyKey });

  expect(lost.error).toEqual(expect.any(TypeError));
  expect(retried.status).toBe("success");
  expect(retried.data?.body.taskId).toBe(droppedTaskId);
  expect(seen.filter((sent) => sent.method === "POST").map((sent) => sent.key)).toEqual([
    idempotencyKey,
    idempotencyKey,
  ]);

  const [first, second] = await Promise.all([
    store.sendCreateTask(request),
    store.sendCreateTask(request),
  ]);

  expect(first.data?.body.taskId).not.toBe(second.data?.body.taskId);
  unmount();
});

test("nothing reads on the server unless the feature opts in", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  const serverProviders = [
    ...appProviders(inject("userToken"), [interceptor]),
    ServerReadingStore,
    { provide: PLATFORM_ID, useValue: "server" },
  ];
  const { result, unmount } = await runInApplication(serverProviders, () => ({
    browserOnly: injectStore(),
    serverReading: angularInject(ServerReadingStore),
  }));

  const skipped = await result.browserOnly.sendListTasks(LIST_REQUEST);
  const read = await result.serverReading.sendListTasks(LIST_REQUEST);

  await wait(QUIET_MS);

  expect(skipped.status).toBe("idle");
  expect(result.browserOnly.listTasks().status).toBe("idle");
  expect(read.status).toBe("success");
  expect(seen.map((sent) => sent.method)).toEqual(["GET"]);
  unmount();
});
