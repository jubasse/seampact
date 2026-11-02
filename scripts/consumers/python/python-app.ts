// Serves an assembled Python consumer for the http suite from its virtual environment: an ASGI app under uvicorn, or
// a WSGI or ASGI app under gunicorn, on a free port, until its control routes answer.
import { join } from "node:path";
import { type RunningApp, startServedApp } from "../served-app.ts";

export type { RunningApp } from "../served-app.ts";

/** Where the app lives and what serves it: [appDirectory] holds the app module, [venv] the installed consumer. */
export interface PythonApp {
  readonly label: string;
  readonly appDirectory: string;
  readonly venv: string;
  /** The app as the server imports it, `module:attribute`. */
  readonly application: string;
}

const LOOPBACK = "127.0.0.1";

// A uvicorn worker under gunicorn, for an ASGI app.
export const GUNICORN_UVICORN_WORKER = "uvicorn.workers.UvicornWorker";

export function pythonOf(venv: string): string {
  return join(venv, "bin", "python");
}

/** Serves the app with uvicorn, with [env] added to its environment. */
export function startUvicornApp(
  app: PythonApp,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startServedApp({
    label: app.label,
    command: pythonOf(app.venv),
    args: (port) => [
      "-m",
      "uvicorn",
      app.application,
      "--host",
      LOOPBACK,
      "--port",
      String(port),
      "--no-access-log",
    ],
    cwd: app.appDirectory,
    env,
  });
}

/** Serves the app with gunicorn and [workers] processes, of [workerClass] when given (an ASGI app's worker). */
export function startGunicornApp(
  app: PythonApp,
  workers: number,
  workerClass?: string,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startServedApp({
    label: app.label,
    command: pythonOf(app.venv),
    args: (port) => [
      "-m",
      "gunicorn",
      app.application,
      "--bind",
      `${LOOPBACK}:${port}`,
      "--workers",
      String(workers),
      ...(workerClass === undefined ? [] : ["--worker-class", workerClass]),
    ],
    cwd: app.appDirectory,
    env,
  });
}
