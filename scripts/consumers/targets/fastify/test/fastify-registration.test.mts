// What the shared suite cannot set up: the boundary's own compression under `@fastify/compress`, which skips the
// hijacked contract replies, with the 304 of a reply above its threshold, and the boot check on a registration prefix. The suite's server registers the tasks
// plugin under its base path, so every suite case also runs under that prefix.

import { COMPRESSION_THRESHOLD_BYTES, compressedReply } from "@seampact/server-runtime/node";
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

// The reference api's only ETag reply is far below the threshold, so the 304 is built here.
const STRONG_ETAG = '"representation"';
const LARGE_BODY_BYTES = COMPRESSION_THRESHOLD_BYTES * 2;

function okReply() {
  return {
    status: 200,
    headers: [["etag", STRONG_ETAG]] as const,
    body: new Uint8Array(LARGE_BODY_BYTES).fill(0x61),
  };
}

function notModifiedReply(representationBytes: number) {
  return {
    status: 304,
    headers: [["etag", STRONG_ETAG]] as const,
    body: new Uint8Array(),
    representationBytes,
  };
}

function headerOf(reply: ReturnType<typeof compressedReply>, name: string): string | undefined {
  return reply.headers.find(([headerName]) => headerName.toLowerCase() === name)?.[1];
}

describe("a 304 under the boundary's compression", () => {
  test("carries the ETag and Vary its encoded 200 has", () => {
    const encodedOk = compressedReply(okReply(), "gzip", COMPRESSION_THRESHOLD_BYTES);
    const notModified = compressedReply(
      notModifiedReply(LARGE_BODY_BYTES),
      "gzip",
      COMPRESSION_THRESHOLD_BYTES,
    );

    expect(headerOf(encodedOk, "content-encoding")).toBe("gzip");
    expect(headerOf(notModified, "etag")).toBe(headerOf(encodedOk, "etag"));
    expect(headerOf(notModified, "vary")).toBe(headerOf(encodedOk, "vary"));
    expect(headerOf(notModified, "content-encoding")).toBeUndefined();
    expect(notModified.body.byteLength).toBe(0);
  });

  test("keeps the strong ETag when its 200 is not encoded", () => {
    const notModified = compressedReply(
      notModifiedReply(LARGE_BODY_BYTES),
      "identity",
      COMPRESSION_THRESHOLD_BYTES,
    );

    expect(headerOf(notModified, "etag")).toBe(STRONG_ETAG);
    expect(headerOf(notModified, "vary")).toBe("Accept-Encoding");
  });

  test("is left as is for a 200 below the threshold", () => {
    const notModified = compressedReply(
      notModifiedReply(COMPRESSION_THRESHOLD_BYTES - 1),
      "gzip",
      COMPRESSION_THRESHOLD_BYTES,
    );

    expect(notModified.headers).toEqual([["etag", STRONG_ETAG]]);
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
