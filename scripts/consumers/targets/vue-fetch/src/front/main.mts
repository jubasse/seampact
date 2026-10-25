// The app's entry, which `vite build` bundles: the channel's tasks and the form that creates one, with no plugin.
import { createApp, h } from "vue";
import { CreateTask, TaskList, tasksComposablesFor } from "./app.mjs";

const Tasks = tasksComposablesFor(new URLSearchParams(window.location.search).get("token") ?? "");

createApp(() => [h(TaskList, { Tasks }), h(CreateTask, { Tasks, title: "A new task" })]).mount(
  "#root",
);
