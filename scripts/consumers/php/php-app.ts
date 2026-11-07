// Serves an assembled PHP consumer (Laravel or Symfony) with PHP's built-in server on a free port and waits until its
// control routes answer, so the http suite runs against the app as built.
import { join } from "node:path";
import { type RunningApp, startServedApp } from "../served-app.ts";

export type { RunningApp } from "../served-app.ts";

// Several workers, so a request a case holds in its handler does not keep the next one waiting; PHP shares nothing
// between requests, so the app's state already lives in files.
const SERVER_WORKERS = "4";

/**
 * Serves the app in [appDirectory] through its `public/index.php` with several workers, with [env] added to its
 * environment.
 */
export function startPhpApp(
  label: string,
  appDirectory: string,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startServedApp({
    label,
    command: "php",
    args: (port) => ["-S", `127.0.0.1:${port}`, "-t", "public", join("public", "index.php")],
    cwd: appDirectory,
    env: { PHP_CLI_SERVER_WORKERS: SERVER_WORKERS, ...env },
  });
}
