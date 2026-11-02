// Serves the assembled DRF consumer for the http suite as the shared Django serving does, under the server
// SEAMPACT_DRF_SERVER names.
import {
  type DjangoServer,
  djangoApp,
  djangoServerOf,
  startDjangoApp,
} from "../../../python/django-app.ts";
import type { PythonApp, RunningApp } from "../../../python/python-app.ts";

export { moduleServedBy } from "../../../python/django-app.ts";
export type { RunningApp } from "../../../python/python-app.ts";

export type DrfServer = DjangoServer;

export function drfServerOf(value: string | undefined): DrfServer {
  return djangoServerOf("SEAMPACT_DRF_SERVER", value);
}

export function drfApp(appDirectory: string, venv: string, server: DrfServer): PythonApp {
  return djangoApp("the DRF consumer", appDirectory, venv, server);
}

export function startDrfApp(app: PythonApp, server: DrfServer): Promise<RunningApp> {
  return startDjangoApp(app, server);
}
