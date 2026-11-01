// The default logger of a NestJS api's boundary: NestJS's own `Logger` under the api's context, so seampact's
// warnings follow `app.useLogger(...)` and its level filters. An explicit `logger` option replaces it.
import { inspect } from "node:util";
import { Logger } from "@nestjs/common";
import type { RuntimeLogger } from "./runtime-logger.js";

const CONTEXT_PREFIX = "Seampact:";

/** The boundary's logger of one api over NestJS's `Logger`, its context `Seampact:<api>`. */
export function nestRuntimeLogger(apiId: string): RuntimeLogger {
  const logger = new Logger(`${CONTEXT_PREFIX}${apiId}`);

  return {
    warn: (...parts) => logger.warn(logText(parts)),
    error: (...parts) => {
      // NestJS prints a stack given as the second argument; an `Error` object would print as `{}`.
      const failure = parts.find((part) => part instanceof Error);

      if (failure?.stack === undefined) {
        logger.error(logText(parts));

        return;
      }

      logger.error(logText(parts.filter((part) => part !== failure)), failure.stack);
    },
  };
}

function logText(parts: readonly unknown[]): string {
  return parts.map((part) => (typeof part === "string" ? part : inspect(part))).join(" ");
}
