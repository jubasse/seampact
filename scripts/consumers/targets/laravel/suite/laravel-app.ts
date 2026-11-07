// Serves the assembled Laravel consumer for the http suite.
import { type RunningApp, startPhpApp } from "../../../php/php-app.ts";

export type { RunningApp } from "../../../php/php-app.ts";

export function startLaravelApp(
  appDirectory: string,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startPhpApp("the Laravel consumer", appDirectory, env);
}
