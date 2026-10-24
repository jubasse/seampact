// The react-fetch consumer's app: the channel's tasks through the generated plain fetch hooks over the generated fetch
// client, with a "Refresh" button since nothing refreshes the list by itself, and a form that creates a task.
import type { ReactNode } from "react";
import { createClient } from "../../generated/client/tasks/index.js";
import {
  createTasksHooks,
  isContractError,
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

export function TaskList(props: {
  readonly Tasks: TasksHooks;
  readonly channelId?: string;
}): ReactNode {
  const tasks = props.Tasks.useListTasks({
    path: { channelId: props.channelId ?? GENERAL_CHANNEL_ID },
  });

  if (tasks.error !== undefined) return <p role="alert">{tasks.error.message}</p>;

  if (tasks.data === undefined) return <p>Loading</p>;

  return (
    <section>
      <ul aria-label="tasks">
        {tasks.data.body.items.map((task) => (
          <li key={task.taskId}>{task.title}</li>
        ))}
      </ul>
      <button type="button" disabled={tasks.isLoading} onClick={tasks.refetch}>
        Refresh
      </button>
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
        disabled={create.isPending}
        onClick={() =>
          void create.mutate({
            path: { channelId: GENERAL_CHANNEL_ID },
            body: { title: props.title },
          })
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
