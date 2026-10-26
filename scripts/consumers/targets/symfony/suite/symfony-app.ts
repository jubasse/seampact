// Serves the assembled Symfony consumer for the http suite.
import { type RunningApp, startPhpApp } from "../../../php/php-app.ts";

export type { RunningApp } from "../../../php/php-app.ts";

export function startSymfonyApp(
  appDirectory: string,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startPhpApp("the Symfony consumer", appDirectory, env);
}
