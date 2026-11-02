// The tasks entry's `nativeDocs` on the assembled FastAPI consumer: FastAPI's `/openapi.json` holds each tasks
// operation with the operation object of seampact's `full` document, which `seampact generate` wrote into the app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { fastApiApp, type RunningApp, startFastApiApp } from "./fastapi-app.ts";

const SEAMPACT_DOCUMENT = "openapi/tasks.full.yaml";

type Paths = Record<string, Record<string, { operationId?: string }>>;

function requiredEnvironment(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === "") throw new Error(`Set ${name} to run the FastAPI suite.`);

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

describe("fastapi nativeDocs", () => {
  const appDirectory = requiredEnvironment("SEAMPACT_FASTAPI_APP");
  let running: RunningApp;

  beforeAll(async () => {
    running = await startFastApiApp(
      fastApiApp(appDirectory, requiredEnvironment("SEAMPACT_FASTAPI_VENV")),
    );
  });

  afterAll(async () => {
    await running.close();
  });

  it("serves each tasks operation with seampact's operation object", async () => {
    const seampact = parse(readFileSync(join(appDirectory, SEAMPACT_DOCUMENT), "utf8")) as {
      paths: Paths;
    };
    const response = await fetch(`${running.baseUrl}/openapi.json`);
    const served = (await response.json()) as { paths: Paths };
    const servedOperations = operationsById(served.paths);

    for (const [operationId, operation] of operationsById(seampact.paths)) {
      expect(servedOperations.get(operationId), operationId).toEqual(operation);
    }
  });
});
