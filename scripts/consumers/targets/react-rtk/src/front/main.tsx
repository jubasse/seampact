// The app's entry, which `vite build` bundles: one store with the api and the channel's tasks.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { CreateTask, InfiniteTaskList, storeFor, tasksApiFor } from "./app.js";

const root = document.getElementById("root");

if (root === null) throw new Error("The page has no #root element.");

const Tasks = tasksApiFor(new URLSearchParams(window.location.search).get("token") ?? "");

createRoot(root).render(
  <StrictMode>
    <Provider store={storeFor(Tasks)}>
      <InfiniteTaskList Tasks={Tasks} />
      <CreateTask Tasks={Tasks} title="A new task" />
    </Provider>
  </StrictMode>,
);
