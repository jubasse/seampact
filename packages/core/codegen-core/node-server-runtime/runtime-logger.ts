// Where the generated boundary writes the messages it has for the operator (a warning, an unexpected failure). The
// console by default; an app hands its own logger in the registration options (`logger`). One logger per api: a
// runtime copied into each api's tree holds one, and the shared runtime package keys them by the api's route table.
// Copied into the generated tree as is.
import { boundaryContext } from "./boundary-context.js";

/** The two levels the boundary writes. */
export interface RuntimeLogger {
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
}

let installedLogger: RuntimeLogger | undefined;
// The logger of each api registered with its route table, read inside that api's requests.
const apiLoggers = new WeakMap<object, RuntimeLogger>();

/** The boundary's logger: the app's when it registered one, else the console, read at each call. */
export const runtimeLog: RuntimeLogger = {
  warn: (...parts) => currentLogger().warn(...parts),
  error: (...parts) => currentLogger().error(...parts),
};

// Inside a contract request, the logger of the request's api; outside one, the last registration's.
function currentLogger(): RuntimeLogger {
  const api = boundaryContext.getStore()?.api;
  const requestLogger = api === undefined ? undefined : apiLoggers.get(api);

  return requestLogger ?? installedLogger ?? console;
}

function isRuntimeLogger(logger: unknown): logger is RuntimeLogger {
  return (
    typeof logger === "object" &&
    logger !== null &&
    typeof Reflect.get(logger, "warn") === "function" &&
    typeof Reflect.get(logger, "error") === "function"
  );
}

/**
 * Installs the logger of a registration, before its boot check so that the check logs through it; a registration
 * without one, or with one the boot check refuses, leaves the current logger. Given the api's route table, the logger
 * is the api's own: a registration without one keeps the api's earlier logger, else the console.
 */
export function useRuntimeLogger(logger: unknown, api?: object): void {
  if (api === undefined) {
    if (isRuntimeLogger(logger)) installedLogger = logger;

    return;
  }

  const apiLogger = isRuntimeLogger(logger) ? logger : (apiLoggers.get(api) ?? console);

  apiLoggers.set(api, apiLogger);
  installedLogger = apiLogger;
}

/** The boot problems of a `logger` that is not an object with `warn` and `error` functions; none when it is. */
export function loggerProblems(logger: unknown): { problem: string; fix: string }[] {
  if (logger === undefined || isRuntimeLogger(logger)) return [];

  return [
    {
      problem: "'logger' is not an object with 'warn' and 'error' functions",
      fix: "pass `logger: { warn, error }`, such as console or a pino-like logger, or leave it out",
    },
  ];
}
