// What the shared suite cannot set up: the boundary's own compression under `@fastify/compress`, which skips the
// hijacked contract replies, and the boot check on a registration prefix. The suite's server registers the tasks
// plugin under its base path, so every suite case also runs under that prefix.
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as TasksFastify from "../generated/server/tasks/index.js";
import { USER_TOKEN } from "./credentials.mjs";
import { startServer, tasksRegistration } from "./server.mjs";

const BATCH_PATH = "/v1/channels/10000000-0000-4000-8000-000000000001/tasks/batch";
// Enough tasks for a body above the compression threshold of 1024 bytes.
const BATCH_SIZE = 12;

let server: Awaited<ReturnType<typeof startServer>> | undefined;

beforeAll(async () => {
  server = await startServer();
});

afterAll(async () => {
  await server?.close();
});

function batchIds(): string[] {
  return Array.from(
    { length: BATCH_SIZE },
    (_unused, index) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

async function readBatch(acceptEncoding: string): Promise<Response> {
  return fetch(`${server?.baseUrl}${BATCH_PATH}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${USER_TOKEN}`,
      "content-type": "application/json",
      "accept-encoding": acceptEncoding,
    },
    body: JSON.stringify({ ids: batchIds() }),
  });
}

describe("contract replies under @fastify/compress", () => {
  test("a reply above the threshold is compressed in the coding the client accepts", async () => {
    const response = await readBatch("gzip");
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")?.toLowerCase()).toContain("accept-encoding");
    expect(Object.keys(body ?? {})).toHaveLength(BATCH_SIZE);
  });

  test("a client that accepts no coding gets the identity body", async () => {
    const response = await readBatch("identity");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
  });
});

describe("the registration prefix", () => {
  test("a prefix other than the contract's base path stops the boot, naming the one it allows", async () => {
    const app = Fastify();

    // Not awaited: the load error surfaces through ready().
    app.register(TasksFastify.plugin, { prefix: "/api", ...tasksRegistration() });

    await expect(app.ready()).rejects.toThrow(/prefix '\/api'[\s\S]*under the prefix '\/v1'/);
  });
});
