// Where the generated boundary writes the messages it has for the operator (a warning, an unexpected failure). The
// console by default; an app hands its own logger in the registration options (`logger`). One logger per generated
// api tree. Copied into the generated tree as is.

/** The two levels the boundary writes. */
export interface RuntimeLogger {
  warn(...parts: unknown[]): void;
  error(...parts: unknown[]): void;
}

let installedLogger: RuntimeLogger | undefined;

/** The boundary's logger: the app's when it registered one, else the console, read at each call. */
export const runtimeLog: RuntimeLogger = {
  warn: (...parts) => (installedLogger ?? console).warn(...parts),
  error: (...parts) => (installedLogger ?? console).error(...parts),
};

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
 * without one, or with one the boot check refuses, leaves the current logger.
 */
export function useRuntimeLogger(logger: unknown): void {
  if (isRuntimeLogger(logger)) installedLogger = logger;
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
