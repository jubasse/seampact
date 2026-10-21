// The react-rtk consumer's app: the channel's tasks through the generated RTK Query api over the generated fetch
// client, an infinite list with a "more" button, and a form that creates a task. The store keeps plain errors;
// `toContractError` turns a declared one back into the client's class.
import {
  configureStore,
  type Middleware,
  type Reducer,
  type SerializedError,
} from "@reduxjs/toolkit";
import type { ReactNode } from "react";
import { createClient } from "../../generated/client/tasks/index.js";
import {
  createTasksApi,
  itemsOf,
  type TasksApi,
  type TasksFailure,
  toContractError,
} from "../../generated/queries/tasks/index.js";

export const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";

/** The api over a client calling the page's own origin with the user's token. */
export function tasksApiFor(token: string, send: typeof fetch = fetch): TasksApi {
  return createTasksApi(
    createClient({
      baseUrl: window.location.origin,
      headers: { authorization: `Bearer ${token}` },
      fetch: send,
    }),
  );
}

/** The parts of a generated api a store holds. */
export interface StoredApi {
  readonly reducerPath: string;
  readonly reducer: Reducer;
  readonly middleware: Middleware;
}

/** A store holding the api's slice and middleware. */
export function storeFor(api: StoredApi) {
  return configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (defaults) => defaults().concat(api.middleware),
  });
}

// A failure the `queryFn` returned is plain and has a `kind`; an RTK `SerializedError` comes from RTK itself.
function messageOf(error: TasksFailure | SerializedError): string {
  if (!("kind" in error)) return error.message ?? "The request failed.";

  return error.kind === "rejection" ? error.message : toContractError(error).message;
}

export function TaskList(props: { readonly Tasks: TasksApi }): ReactNode {
  const tasks = props.Tasks.useListTasksQuery({ path: { channelId: GENERAL_CHANNEL_ID } });

  if (tasks.error !== undefined) return <p role="alert">{messageOf(tasks.error)}</p>;

  if (tasks.data === undefined) return <p>Loading</p>;

  return (
    <ul aria-label="tasks">
      {tasks.data.body.items.map((task) => (
        <li key={task.taskId}>{task.title}</li>
      ))}
    </ul>
  );
}

export function InfiniteTaskList(props: { readonly Tasks: TasksApi }): ReactNode {
  const tasks = props.Tasks.useListTasksInfiniteInfiniteQuery({
    path: { channelId: GENERAL_CHANNEL_ID },
  });

  if (tasks.error !== undefined) return <p role="alert">{messageOf(tasks.error)}</p>;

  if (tasks.data === undefined) return <p>Loading</p>;

  return (
    <section>
      <ul aria-label="tasks">
        {itemsOf(tasks.data).map((task) => (
          <li key={task.taskId}>{task.title}</li>
        ))}
      </ul>
      {tasks.hasNextPage ? (
        <button
          type="button"
          disabled={tasks.isFetchingNextPage}
          onClick={() => void tasks.fetchNextPage()}
        >
          More
        </button>
      ) : (
        <p>End of the list</p>
      )}
    </section>
  );
}

export function CreateTask(props: { readonly Tasks: TasksApi; readonly title: string }): ReactNode {
  const [createTask, created] = props.Tasks.useCreateTaskMutation();
  const error = created.error;
  const failure =
    error !== undefined &&
    "kind" in error &&
    error.kind === "contract" &&
    error.operation === "createTask"
      ? error.failure
      : undefined;

  return (
    <section>
      <button
        type="button"
        onClick={() =>
          void createTask({ path: { channelId: GENERAL_CHANNEL_ID }, body: { title: props.title } })
        }
      >
        Create
      </button>
      {created.data !== undefined ? <p>Created {created.data.body.title}</p> : null}
      {failure !== undefined && !failure.unexpected ? (
        <p role="alert">
          {failure.code}
          {failure.code === "api.rate_limited"
            ? ` retry after ${failure.params.retryAfterMs} ms`
            : ""}
        </p>
      ) : null}
    </section>
  );
}
