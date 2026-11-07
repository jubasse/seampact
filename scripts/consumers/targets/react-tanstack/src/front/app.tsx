// The react-tanstack consumer's app: the channel's tasks through the generated TanStack Query hooks over the
// generated fetch client, an infinite list with a "more" button, and a form that creates a task.
import type { ReactNode } from "react";
import { createClient } from "../../generated/client/tasks/index.js";
import {
  createTasksHooks,
  isContractError,
  itemsOf,
  type TasksHooks,
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

  if (tasks.isPending) return <p>Loading</p>;

  if (tasks.isError) return <p role="alert">{tasks.error.message}</p>;

  return (
    <ul aria-label="tasks">
      {tasks.data.body.items.map((task) => (
        <li key={task.taskId}>{task.title}</li>
      ))}
    </ul>
  );
}

export function InfiniteTaskList(props: { readonly Tasks: TasksHooks }): ReactNode {
  const tasks = props.Tasks.useListTasksInfinite({ path: { channelId: GENERAL_CHANNEL_ID } });

  if (tasks.isPending) return <p>Loading</p>;

  if (tasks.isError) return <p role="alert">{tasks.error.message}</p>;

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
          create.mutate({ path: { channelId: GENERAL_CHANNEL_ID }, body: { title: props.title } })
        }
      >
        Create
      </button>
      {create.isSuccess ? <p>Created {create.data.body.title}</p> : null}
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
