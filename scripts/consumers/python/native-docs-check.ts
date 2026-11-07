// The `nativeDocs` check of a Python consumer: the app's own OpenAPI document holds each operation of the tasks entry
// with the operation object of seampact's `full` document, which `seampact generate` wrote into the app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { PythonApp, RunningApp } from "./python-app.ts";

const SEAMPACT_DOCUMENT = "openapi/tasks.full.yaml";

type Paths = Record<string, Record<string, { operationId?: string }>>;

/** The consumer whose document the check reads, and the path the framework serves its document at. */
export interface NativeDocsTarget {
  readonly target: string;
  readonly environmentPrefix: string;
  readonly appOf: (appDirectory: string, venv: string) => PythonApp;
  readonly start: (app: PythonApp) => Promise<RunningApp>;
  readonly documentPath: string;
}

function requiredEnvironment(name: string, target: string): string {
  const value = process.env[name];

  if (value === undefined || value === "")
    throw new Error(`Set ${name} to run the ${target} suite.`);

  return value;
}

function operationsById(paths: Paths): Map<string, unknown> {
  return new Map(
    Object.values(paths).flatMap((item) =>
      Object.values(item).flatMap((operation) =>
        operation.operationId === undefined ? [] : [[operation.operationId, operation] as const],
      ),
    ),
  );
}

export function describeNativeDocsCheck(consumer: NativeDocsTarget): void {
  describe(`${consumer.target} nativeDocs`, () => {
    const appDirectory = requiredEnvironment(`${consumer.environmentPrefix}_APP`, consumer.target);
    const venv = requiredEnvironment(`${consumer.environmentPrefix}_VENV`, consumer.target);
    let running: RunningApp;

    beforeAll(async () => {
      running = await consumer.start(consumer.appOf(appDirectory, venv));
    });

    afterAll(async () => {
      await running.close();
    });

    it("serves each tasks operation with seampact's operation object", async () => {
      const seampact = parse(readFileSync(join(appDirectory, SEAMPACT_DOCUMENT), "utf8")) as {
        paths: Paths;
      };
      const response = await fetch(`${running.baseUrl}${consumer.documentPath}`);
      const served = (await response.json()) as { paths: Paths };
      const servedOperations = operationsById(served.paths);

      for (const [operationId, operation] of operationsById(seampact.paths)) {
        expect(servedOperations.get(operationId), operationId).toEqual(operation);
      }
    });
  });
}
