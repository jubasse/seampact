// The vue-fetch consumer's app: the channel's tasks through the generated plain fetch composables over the generated
// fetch client, with a "Refresh" button since nothing refreshes the list by itself, and a form that creates a task.
import { defineComponent, h } from "vue";
import { createClient } from "../../generated/client/tasks/index.js";
import {
  createTasksComposables,
  isContractError,
  type TasksComposables,
} from "../../generated/queries/tasks/index.js";

export const GENERAL_CHANNEL_ID = "10000000-0000-4000-8000-000000000001";

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
  (props: { readonly Tasks: TasksComposables; readonly channelId?: string }) => {
    const tasks = props.Tasks.useListTasks(() => ({
      path: { channelId: props.channelId ?? GENERAL_CHANNEL_ID },
    }));

    return () => {
      const error = tasks.error.value;
      const data = tasks.data.value;

      if (error !== undefined) return h("p", { role: "alert" }, error.message);

      if (data === undefined) return h("p", "Loading");

      return h("section", [
        h(
          "ul",
          { "aria-label": "tasks" },
          data.body.items.map((task) => h("li", { key: task.taskId }, task.title)),
        ),
        h(
          "button",
          { type: "button", disabled: tasks.isLoading.value, onClick: tasks.refetch },
          "Refresh",
        ),
      ]);
    };
  },
  { props: ["Tasks", "channelId"] },
);

export const CreateTask = defineComponent(
  (props: { readonly Tasks: TasksComposables; readonly title: string }) => {
    const create = props.Tasks.useCreateTask();
    const send = () =>
      void create.mutate({ path: { channelId: GENERAL_CHANNEL_ID }, body: { title: props.title } });

    return () => {
      const error = create.error.value;
      const failure = isContractError(error) ? error.failure : undefined;
      const created = create.data.value;

      return h("section", [
        h("button", { type: "button", disabled: create.isPending.value, onClick: send }, "Create"),
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
