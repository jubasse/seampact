// The app's entry, which `vite build` bundles: the channel's tasks and the form that creates one, under the app's
// own Pinia and Pinia Colada.
import { PiniaColada } from "@pinia/colada";
import { createPinia } from "pinia";
import { createApp, h } from "vue";
import { CreateTask, TaskList, tasksComposablesFor } from "./app.mjs";

const Tasks = tasksComposablesFor(new URLSearchParams(window.location.search).get("token") ?? "");

createApp(() => [h(TaskList, { Tasks }), h(CreateTask, { Tasks, title: "A new task" })])
  .use(createPinia())
  .use(PiniaColada)
  .mount("#root");
