// Serves the assembled DRF consumer for the http suite from the virtual environment it was installed in: under
// gunicorn as a WSGI app (the Django 5.2 row), or under uvicorn as an ASGI app (the Django 6 row), as
// SEAMPACT_DRF_SERVER says.
import {
  type PythonApp,
  type RunningApp,
  startGunicornApp,
  startUvicornApp,
} from "../../../python/python-app.ts";

export type { RunningApp } from "../../../python/python-app.ts";

export const DRF_WSGI_MODULE = "wsgi";
export const DRF_ASGI_MODULE = "asgi";
const APPLICATION_ATTRIBUTE = "application";
const GUNICORN_WORKERS = 2;

export type DrfServer = "gunicorn" | "uvicorn";

export function drfServerOf(value: string | undefined): DrfServer {
  if (value === "gunicorn" || value === "uvicorn") return value;

  throw new Error(`Set SEAMPACT_DRF_SERVER to gunicorn or uvicorn, not '${value ?? ""}'.`);
}

export function moduleServedBy(server: DrfServer): string {
  return server === "gunicorn" ? DRF_WSGI_MODULE : DRF_ASGI_MODULE;
}

export function drfApp(appDirectory: string, venv: string, server: DrfServer): PythonApp {
  return {
    label: `the DRF consumer under ${server}`,
    appDirectory,
    venv,
    application: `${moduleServedBy(server)}:${APPLICATION_ATTRIBUTE}`,
  };
}

export function startDrfApp(app: PythonApp, server: DrfServer): Promise<RunningApp> {
  return server === "gunicorn" ? startGunicornApp(app, GUNICORN_WORKERS) : startUvicornApp(app);
}
