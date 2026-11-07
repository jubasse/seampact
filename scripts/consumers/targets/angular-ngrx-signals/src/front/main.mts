// The app's entry, which `vite build` bundles: the channel's tasks from the app's Signal Store, fed by the generated
// features.
// The JIT compiler loads first: Angular's partially compiled packages need it as they load.
import "@angular/compiler";
import { bootstrapApplication } from "@angular/platform-browser";
import { appProviders, TaskBoard } from "./app.mjs";

const token = new URLSearchParams(window.location.search).get("token") ?? "";

bootstrapApplication(TaskBoard, { providers: appProviders(token) }).catch((failure: unknown) => {
  console.error("angular-ngrx-signals: the app did not start.", failure);
});
