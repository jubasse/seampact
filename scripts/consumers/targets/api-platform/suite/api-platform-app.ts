// Serves the assembled API Platform consumer for the http suite.
import { type RunningApp, startPhpApp } from "../../../php/php-app.ts";

export type { RunningApp } from "../../../php/php-app.ts";

export function startApiPlatformApp(
  appDirectory: string,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startPhpApp("the API Platform consumer", appDirectory, env);
}
