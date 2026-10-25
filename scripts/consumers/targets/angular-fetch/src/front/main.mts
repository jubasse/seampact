// The app's entry, which `vite build` bundles: the channel's tasks and the form that creates one. The JIT compiler
// loads first: Angular's partially compiled packages need it as they load.
import "@angular/compiler";
import { bootstrapApplication } from "@angular/platform-browser";
import { appProviders, TasksPage } from "./app.mjs";

const token = new URLSearchParams(window.location.search).get("token") ?? "";

bootstrapApplication(TasksPage, { providers: appProviders(token) }).catch((failure: unknown) => {
  console.error("angular-fetch: the app did not start.", failure);
});
