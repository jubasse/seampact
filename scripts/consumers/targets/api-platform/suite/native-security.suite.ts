// API Platform's `security` on a contract operation (ADR 0029 "Native security"): the consumer's metadata decorator
// secures `createTask` with an expression that refuses a request carrying a probe header. The expression runs after the
// boundary admitted the request and before the handler, and the exception it throws answers the api's `forbidden`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type RunningApp, requiredEnvironment, startApiPlatformApp } from "./api-platform-app.ts";

const PROBE_HEADER = "x-seampact-suite-api-platform-deny";
const CREATE_TASK_PATH = "/v1/channels/10000000-0000-4000-8000-000000000001/tasks";
const FORBIDDEN_CODE = "api.forbidden";

const credentials = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../spring-boot/credentials.json"), "utf8"),
);

describe("API Platform security after the boundary", () => {
  let running: RunningApp | undefined;

  beforeAll(async () => {
    running = await startApiPlatformApp(requiredEnvironment("SEAMPACT_API_PLATFORM_APP"));
  });

  afterAll(async () => {
    await running?.close();
  });

  function createTask(key: string, extraHeaders: Record<string, string>): Promise<Response> {
    return fetch(`${running?.baseUrl}${CREATE_TASK_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credentials.userToken}`,
        "content-type": "application/json",
        "idempotency-key": key,
        ...extraHeaders,
      },
      body: JSON.stringify({ title: "Secured by API Platform" }),
    });
  }

  test("an expression that refuses answers the api's forbidden, in its format", async () => {
    const reply = await createTask("security-deny-0001", { [PROBE_HEADER]: "true" });

    expect(reply.status).toBe(403);
    expect(reply.headers.get("content-type")).toContain("application/problem+json");
    expect(await reply.json()).toMatchObject({ code: FORBIDDEN_CODE, status: 403 });
  });

  test("an expression that admits lets the handler answer", async () => {
    const reply = await createTask("security-admit-0001", {});

    expect(reply.status).toBe(201);
  });
});
