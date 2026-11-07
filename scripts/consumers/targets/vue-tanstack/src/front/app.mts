// The vue-tanstack consumer's app: the channel's tasks through the generated TanStack Query composables over the
// generated fetch client, an infinite list with a "More" button, and a form that creates a task.
import { defineComponent, h } from "vue";
import { createClient } from "../../generated/client/tasks/index.js";
import {
  createTasksComposables,
  isContractError,
  itemsOf,
  type TasksComposables,
} from "../../generated/queries/tasks/index.js";

export const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";

const LIST_REQUEST = { path: { channelId: GENERAL_CHANNEL_ID } };

/** The composables over a client calling the page's own origin with the user's token. */
export function tasksComposablesFor(token: string, send: typeof fetch = fetch): TasksComposables {
  return createTasksComposables(
    createClient({
      baseUrl: window.location.origin,
      headers: { authorization: `Bearer ${token}` },
      fetch: send,
    }),
  );
}

export const TaskList = defineComponent(
  (props: { readonly Tasks: TasksComposables }) => {
    const tasks = props.Tasks.useListTasks(LIST_REQUEST);

    return () => {
      const error = tasks.error.value;
      const data = tasks.data.value;

      if (error !== null) return h("p", { role: "alert" }, error.message);

      if (data === undefined) return h("p", "Loading");

      return h(
        "ul",
        { "aria-label": "tasks" },
        data.body.items.map((task) => h("li", { key: task.taskId }, task.title)),
      );
    };
  },
  { props: ["Tasks"] },
);

export const InfiniteTaskList = defineComponent(
  (props: { readonly Tasks: TasksComposables }) => {
    const tasks = props.Tasks.useListTasksInfinite(LIST_REQUEST);
    const more = () => void tasks.fetchNextPage();

    return () => {
      const error = tasks.error.value;
      const data = tasks.data.value;

      if (error !== null) return h("p", { role: "alert" }, error.message);

      if (data === undefined) return h("p", "Loading");

      return h("section", [
        h(
          "ul",
          { "aria-label": "tasks" },
          itemsOf(data).map((task) => h("li", { key: task.taskId }, task.title)),
        ),
        tasks.hasNextPage.value
          ? h(
              "button",
              { type: "button", disabled: tasks.isFetchingNextPage.value, onClick: more },
              "More",
            )
          : h("p", "End of the list"),
      ]);
    };
  },
  { props: ["Tasks"] },
);

export const CreateTask = defineComponent(
  (props: { readonly Tasks: TasksComposables; readonly title: string }) => {
    const create = props.Tasks.useCreateTask();
    const send = () =>
      create.mutate({ path: { channelId: GENERAL_CHANNEL_ID }, body: { title: props.title } });

    return () => {
      const error = create.error.value;
      const failure = isContractError(error) ? error.failure : undefined;
      const created = create.data.value;

      return h("section", [
        h("button", { type: "button", onClick: send }, "Create"),
        created === undefined ? null : h("p", `Created ${created.body.title}`),
        failure === undefined || failure.unexpected
          ? null
          : h(
              "p",
              { role: "alert" },
              failure.code === "api.rate_limited"
                ? `${failure.code} retry after ${failure.params.retryAfterMs} ms`
                : failure.code,
            ),
      ]);
    };
  },
  { props: ["Tasks", "title"] },
);
