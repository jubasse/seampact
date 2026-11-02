// Serves the assembled FastAPI consumer for the http suite under uvicorn, from the virtual environment it was
// installed in.
import { type PythonApp, type RunningApp, startUvicornApp } from "../../../python/python-app.ts";

export type { RunningApp } from "../../../python/python-app.ts";

export const FASTAPI_APPLICATION = "main:app";

export function fastApiApp(appDirectory: string, venv: string): PythonApp {
  return {
    label: "the FastAPI consumer",
    appDirectory,
    venv,
    application: FASTAPI_APPLICATION,
  };
}

export function startFastApiApp(
  app: PythonApp,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startUvicornApp(app, env);
}
