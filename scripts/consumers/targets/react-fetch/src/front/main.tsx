// The app's entry, which `vite build` bundles: the channel's tasks and the form that creates one, with no provider.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CreateTask, TaskList, tasksHooksFor } from "./app.js";

const root = document.getElementById("root");

if (root === null) throw new Error("The page has no #root element.");

const Tasks = tasksHooksFor(new URLSearchParams(window.location.search).get("token") ?? "");

createRoot(root).render(
  <StrictMode>
    <TaskList Tasks={Tasks} />
    <CreateTask Tasks={Tasks} title="A new task" />
  </StrictMode>,
);
