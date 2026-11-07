// Starts the consumer's jar with `java -jar` on a free port and waits until its control routes answer, so the
// http suite runs against the app as built.
import { type RunningApp, startServedApp } from "../../../served-app.ts";

export type { RunningApp } from "../../../served-app.ts";

/** Starts [jar]; [properties] are Spring properties passed as `--name=value` arguments. */
export function startSpringApp(
  jar: string,
  properties: Readonly<Record<string, string>> = {},
): Promise<RunningApp> {
  const propertyArguments = Object.entries(properties).map(([name, value]) => `--${name}=${value}`);

  return startServedApp({
    label: "the consumer jar",
    command: "java",
    args: (port) => [
      "-jar",
      jar,
      `--server.port=${port}`,
      "--server.address=127.0.0.1",
      ...propertyArguments,
    ],
  });
}
