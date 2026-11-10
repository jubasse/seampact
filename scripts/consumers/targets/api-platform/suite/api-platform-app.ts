// Serves the assembled API Platform consumer for the http suite.
import { type RunningApp, startPhpApp } from "../../../php/php-app.ts";

export type { RunningApp } from "../../../php/php-app.ts";

export function startApiPlatformApp(
  appDirectory: string,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startPhpApp("the API Platform consumer", appDirectory, env);
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") {
    throw new Error(`Set ${name}: the suites run against the assembled consumer (see the README).`);
  }

  return value;
}
