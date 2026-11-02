// Serves an assembled Django consumer for the http suite from the virtual environment it was installed in: under
// gunicorn as a WSGI app (the Django 5.2 rows), or under uvicorn as an ASGI app (the Django 6 rows), as the target's
// server variable says.
import {
  type PythonApp,
  type RunningApp,
  startGunicornApp,
  startUvicornApp,
} from "./python-app.ts";

export type { RunningApp } from "./python-app.ts";

export const DJANGO_WSGI_MODULE = "wsgi";
export const DJANGO_ASGI_MODULE = "asgi";
const APPLICATION_ATTRIBUTE = "application";
const GUNICORN_WORKERS = 2;

export type DjangoServer = "gunicorn" | "uvicorn";

/** The server [variable] names, `gunicorn` or `uvicorn`; throws naming the variable otherwise. */
export function djangoServerOf(variable: string, value: string | undefined): DjangoServer {
  if (value === "gunicorn" || value === "uvicorn") return value;

  throw new Error(`Set ${variable} to gunicorn or uvicorn, not '${value ?? ""}'.`);
}

export function moduleServedBy(server: DjangoServer): string {
  return server === "gunicorn" ? DJANGO_WSGI_MODULE : DJANGO_ASGI_MODULE;
}

/** The app of [appDirectory] as [server] serves it; [consumer] names it in errors, such as "the DRF consumer". */
export function djangoApp(
  consumer: string,
  appDirectory: string,
  venv: string,
  server: DjangoServer,
): PythonApp {
  return {
    label: `${consumer} under ${server}`,
    appDirectory,
    venv,
    application: `${moduleServedBy(server)}:${APPLICATION_ATTRIBUTE}`,
  };
}

export function startDjangoApp(app: PythonApp, server: DjangoServer): Promise<RunningApp> {
  return server === "gunicorn" ? startGunicornApp(app, GUNICORN_WORKERS) : startUvicornApp(app);
}
