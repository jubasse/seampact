import { describe, expect, test } from "vitest";
import {
  type FingerprintRoute,
  idempotencyFingerprint,
} from "../../node-server-runtime/idempotency-fingerprint.js";

const CREATE_TASK: FingerprintRoute = {
  method: "post",
  path: "/v1/channels/{channelId}/tasks",
  access: {
    kind: "identity",
    credentials: [{ in: "bearer" }, { in: "cookie", name: "session" }],
    csrfHeader: "X-Csrf-Token",
  },
};

function createTaskInput(authorization: string, csrfToken: string): unknown {
  return {
    path: { channelId: "c1" },
    query: {},
    headers: { authorization, "x-csrf-token": csrfToken, "idempotency-key": "key-1" },
    body: { title: "Plan" },
  };
}

// The same vector as the Spring Boot target's `DigestsTest`, so a shared replay store sees one fingerprint.
const CREATE_TASK_FINGERPRINT = "583a81024c92d216cb3209acd8ccdd6f1350f6947a6636235ed8329fc77fde9c";

describe("the idempotency fingerprint", () => {
  test("a retry after a token refresh matches the first request", async () => {
    const first = await idempotencyFingerprint(
      CREATE_TASK,
      createTaskInput("Bearer user-old", "csrf-old"),
    );
    const retry = await idempotencyFingerprint(
      CREATE_TASK,
      createTaskInput("Bearer user-refreshed", "csrf-refreshed"),
    );

    expect(retry).toBe(first);
    expect(first).toBe(CREATE_TASK_FINGERPRINT);
  });
});
