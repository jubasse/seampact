// The app's entry, which `vite build` bundles: the SWR configuration and the channel's tasks.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { CreateTask, InfiniteTaskList, tasksHooksFor } from "./app.js";

const root = document.getElementById("root");

if (root === null) throw new Error("The page has no #root element.");

const Tasks = tasksHooksFor(new URLSearchParams(window.location.search).get("token") ?? "");

createRoot(root).render(
  <StrictMode>
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <InfiniteTaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="A new task" />
    </SWRConfig>
  </StrictMode>,
);
