// Serves the assembled Laravel consumer with PHP's built-in server on a free port and waits until its control
// routes answer, so the http suite runs against the app as built.
import { join } from "node:path";
import { type RunningApp, startServedApp } from "../../../served-app.ts";

export type { RunningApp } from "../../../served-app.ts";

/** Serves the app in [appDirectory] through its `public/index.php`, with [env] added to its environment. */
export function startLaravelApp(
  appDirectory: string,
  env: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  return startServedApp({
    label: "the Laravel consumer",
    command: "php",
    args: (port) => ["-S", `127.0.0.1:${port}`, "-t", "public", join("public", "index.php")],
    cwd: appDirectory,
    env,
  });
}
