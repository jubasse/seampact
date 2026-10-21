// The react-swr consumer's app: the channel's tasks through the generated SWR hooks over the generated fetch client,
// an infinite list with a "more" button, and a form that creates a task.
import type { ReactNode } from "react";
import { createClient } from "../../generated/client/tasks/index.js";
import {
  createTasksHooks,
  type InfiniteCallerConfig,
  isContractError,
  itemsOf,
  type TasksHooks,
  type TasksOperations,
} from "../../generated/queries/tasks/index.js";

export const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";

/** The hooks over a client calling the page's own origin with the user's token. */
export function tasksHooksFor(token: string, send: typeof fetch = fetch): TasksHooks {
  return createTasksHooks(
    createClient({
      baseUrl: window.location.origin,
      headers: { authorization: `Bearer ${token}` },
      fetch: send,
    }),
  );
}

export function TaskList(props: { readonly Tasks: TasksHooks }): ReactNode {
  const tasks = props.Tasks.useListTasks({ path: { channelId: GENERAL_CHANNEL_ID } });

  if (tasks.error !== undefined) return <p role="alert">{tasks.error.message}</p>;

  if (tasks.data === undefined) return <p>Loading</p>;

  return (
    <ul aria-label="tasks">
      {tasks.data.body.items.map((task) => (
        <li key={task.taskId}>{task.title}</li>
      ))}
    </ul>
  );
}

export function InfiniteTaskList(props: {
  readonly Tasks: TasksHooks;
  readonly config?: InfiniteCallerConfig<TasksOperations["listTasks"]>;
}): ReactNode {
  const tasks = props.Tasks.useListTasksInfinite(
    { path: { channelId: GENERAL_CHANNEL_ID } },
    props.config,
  );

  if (tasks.error !== undefined) return <p role="alert">{tasks.error.message}</p>;

  if (tasks.data === undefined) return <p>Loading</p>;

  const lastPage = tasks.data.at(-1);

  return (
    <section>
      <ul aria-label="tasks">
        {itemsOf({ pages: tasks.data }).map((task) => (
          <li key={task.taskId}>{task.title}</li>
        ))}
      </ul>
      {lastPage?.body.nextCursor !== undefined ? (
        <button
          type="button"
          disabled={tasks.isValidating}
          onClick={() => void tasks.setSize(tasks.size + 1)}
        >
          More
        </button>
      ) : (
        <p>End of the list</p>
      )}
    </section>
  );
}

export function CreateTask(props: {
  readonly Tasks: TasksHooks;
  readonly title: string;
}): ReactNode {
  const create = props.Tasks.useCreateTask();
  const failure = isContractError(create.error) ? create.error.failure : undefined;

  return (
    <section>
      <button
        type="button"
        onClick={() =>
          void create.trigger(
            { path: { channelId: GENERAL_CHANNEL_ID }, body: { title: props.title } },
            { throwOnError: false },
          )
        }
      >
        Create
      </button>
      {create.data !== undefined ? <p>Created {create.data.body.title}</p> : null}
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
