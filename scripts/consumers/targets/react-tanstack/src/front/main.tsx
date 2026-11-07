// The app's entry, which `vite build` bundles: one query client and the channel's tasks.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CreateTask, InfiniteTaskList, tasksHooksFor } from "./app.js";

const root = document.getElementById("root");

if (root === null) throw new Error("The page has no #root element.");

const Tasks = tasksHooksFor(new URLSearchParams(window.location.search).get("token") ?? "");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <InfiniteTaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="A new task" />
    </QueryClientProvider>
  </StrictMode>,
);
