// The generated NgRx action groups and effects in a browser page, against the real server through the same-origin
// proxy (ADR 0021 "The end-to-end proof", "Angular"): a dispatched action is sent by the effect through the generated
// service and the app's HttpClient, and its success or failure reaches the app's own reducer. The JIT compiler loads
// first: Angular's partially compiled packages need it as they load.
import "@angular/compiler";
import { HttpErrorResponse, type HttpInterceptorFn } from "@angular/common/http";
import { inject as angularInject } from "@angular/core";
import { Actions, ofType } from "@ngrx/effects";
import { type ActionCreator, Store } from "@ngrx/store";
import { Observable, throwError } from "rxjs";
import { expect, inject, test } from "vitest";
import { page } from "vitest/browser";
import { isContractError, TasksActions } from "../../generated/queries/tasks/index.js";
import {
  type AppState,
  appProviders,
  GENERAL_CHANNEL_ID,
  TaskBoard,
} from "../../src/front/app.mjs";
import { mount, runInApplication } from "./components.mjs";
import { loadScript } from "./control.mjs";
import "./provided.mjs";

const LIST_REQUEST = { path: { channelId: GENERAL_CHANNEL_ID } };
const IDEMPOTENCY_HEADER = "idempotency-key";

interface Dispatching {
  readonly store: Store<AppState>;
  readonly actions: Actions;
  // The type of every action the store saw, in order.
  readonly seen: string[];
}

// The app's store, with the type of every action it sees recorded.
function injectDispatching(): Dispatching {
  const store = angularInject<Store<AppState>>(Store);
  const actions = angularInject(Actions);
  const seen: string[] = [];

  actions.subscribe((action) => {
    seen.push(action.type);
  });

  return { store, actions, seen };
}

// The actions of one creator, recorded from now on, with their props typed.
function recorded<Creator extends ActionCreator>(
  actions: Actions,
  creator: Creator,
): ReturnType<Creator>[] {
  const matching: ReturnType<Creator>[] = [];

  actions.pipe(ofType(creator)).subscribe((action) => {
    matching.push(action);
  });

  return matching;
}

function postedKeys(seen: readonly { method: string; key: string | null }[]): (string | null)[] {
  return seen.filter((request) => request.method === "POST").map((request) => request.key);
}

// An app interceptor that records each request's method and idempotency key.
function recordingInterceptor(): {
  readonly interceptor: HttpInterceptorFn;
  readonly seen: { method: string; key: string | null }[];
} {
  const seen: { method: string; key: string | null }[] = [];
  const interceptor: HttpInterceptorFn = (request, next) => {
    seen.push({ method: request.method, key: request.headers.get(IDEMPOTENCY_HEADER) });

    return next(request);
  };

  return { interceptor, seen };
}

test("a read action yields its success with the data, which the app's reducer keeps", async () => {
  await loadScript({});

  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken")),
    injectDispatching,
  );

  const successes = recorded(result.actions, TasksActions.listTasksSuccess);

  result.store.dispatch(TasksActions.listTasks({ request: LIST_REQUEST }));

  await expect
    .poll(() => result.seen)
    .toEqual(["[Tasks/tasks] listTasks", "[Tasks/tasks] listTasksSuccess"]);

  const [success] = successes;

  if (success === undefined) throw new Error("no listTasksSuccess");

  expect(success.request).toEqual(LIST_REQUEST);
  expect(success.data.body.items.map((task) => task.title)).toEqual(["Write the slice test"]);
  expect(result.store.selectSignal((state) => state.taskList)().titles).toEqual([
    "Write the slice test",
  ]);
  unmount();
});

test("a contract error yields the failure with the typed error, which the app's reducer shows", async () => {
  await loadScript({});

  const view = await mount(TaskBoard, appProviders(inject("throttledUserToken")));

  await page.getByRole("button", { name: "Create" }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent(`api.rate_limited retry after ${inject("throttleRetryAfterMs")} ms`);
  view.unmount();

  const { result, unmount } = await runInApplication(
    appProviders(inject("throttledUserToken")),
    injectDispatching,
  );

  const failures = recorded(result.actions, TasksActions.createTaskFailure);

  result.store.dispatch(
    TasksActions.createTask({ request: { ...LIST_REQUEST, body: { title: "One too many" } } }),
  );

  await expect.poll(() => failures.length).toBe(1);

  const [failure] = failures;

  if (failure === undefined) throw new Error("no createTaskFailure");

  const { error } = failure;

  expect(isContractError(error) && !error.failure.unexpected && error.failure.code).toBe(
    "api.rate_limited",
  );
  unmount();
});

test("an unexpected error is a failure too, and the effect keeps answering", async () => {
  await loadScript({});

  let failedOnce = false;
  // The first request reaches no server.
  const failFirst: HttpInterceptorFn = (request, next) => {
    if (failedOnce) return next(request);

    failedOnce = true;

    return throwError(() => new HttpErrorResponse({ status: 0, url: request.url }));
  };
  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken"), [failFirst]),
    injectDispatching,
  );

  const failures = recorded(result.actions, TasksActions.listTasksFailure);

  result.store.dispatch(TasksActions.listTasks({ request: LIST_REQUEST }));
  await expect.poll(() => result.seen.length).toBe(2);
  result.store.dispatch(TasksActions.listTasks({ request: LIST_REQUEST }));
  await expect.poll(() => result.seen.length).toBe(4);

  expect(result.seen).toEqual([
    "[Tasks/tasks] listTasks",
    "[Tasks/tasks] listTasksFailure",
    "[Tasks/tasks] listTasks",
    "[Tasks/tasks] listTasksSuccess",
  ]);
  expect(failures.map((failure) => failure.error)).toEqual([expect.any(TypeError)]);
  unmount();
});

test("each write action sends its own idempotency key, both sent at once", async () => {
  await loadScript({});

  const { interceptor, seen } = recordingInterceptor();
  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken"), [interceptor]),
    injectDispatching,
  );
  const request = { ...LIST_REQUEST, body: { title: "Write twice" } };

  result.store.dispatch(TasksActions.createTask({ request }));
  result.store.dispatch(TasksActions.createTask({ request }));

  await expect.poll(() => result.seen.length).toBe(4);

  const keys = postedKeys(seen);

  expect(result.seen.filter((type) => type === TasksActions.createTaskSuccess.type)).toHaveLength(
    2,
  );
  expect(keys).toHaveLength(2);
  expect(keys).not.toContain(null);
  expect(new Set(keys).size).toBe(2);
  unmount();
});

test("a read action aborts the read the previous one of its operation still waits on", async () => {
  await loadScript({});

  const cancelled: boolean[] = [];
  // Never answers, and records per request whether it was cancelled.
  const hanging: HttpInterceptorFn = () =>
    new Observable(() => {
      const index = cancelled.push(false) - 1;

      return () => {
        cancelled[index] = true;
      };
    });
  const { result, unmount } = await runInApplication(
    appProviders(inject("userToken"), [hanging]),
    injectDispatching,
  );

  result.store.dispatch(TasksActions.listTasks({ request: LIST_REQUEST }));
  await expect.poll(() => cancelled.length).toBe(1);
  result.store.dispatch(TasksActions.listTasks({ request: LIST_REQUEST }));
  await expect.poll(() => cancelled).toEqual([true, false]);

  expect(result.seen).toHaveLength(2);
  unmount();
});
