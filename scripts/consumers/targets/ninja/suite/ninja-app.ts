// Serves the assembled Django Ninja consumer for the http suite as the shared Django serving does, under the server
// SEAMPACT_NINJA_SERVER names.
import {
  type DjangoServer,
  djangoApp,
  djangoServerOf,
  startDjangoApp,
} from "../../../python/django-app.ts";
import type { PythonApp, RunningApp } from "../../../python/python-app.ts";

export type { RunningApp } from "../../../python/python-app.ts";

export const ninjaServer: DjangoServer = djangoServerOf(
  "SEAMPACT_NINJA_SERVER",
  process.env.SEAMPACT_NINJA_SERVER,
);

export function ninjaApp(appDirectory: string, venv: string): PythonApp {
  return djangoApp("the Django Ninja consumer", appDirectory, venv, ninjaServer);
}

export function startNinjaApp(app: PythonApp): Promise<RunningApp> {
  return startDjangoApp(app, ninjaServer);
}
