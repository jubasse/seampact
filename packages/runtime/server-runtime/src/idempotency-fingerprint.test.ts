import { describe, expect, test } from "vitest";
import { type FingerprintRoute, idempotencyFingerprint } from "./idempotency-fingerprint.js";

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

// The compiler derives `traceparent` and `X-Deadline` from the identity: they are header params, not declared ones.
function createTaskInputWithDerivedHeaders(traceparent: string, deadline: string): unknown {
  return {
    path: { channelId: "c1" },
    query: {},
    headers: { traceparent, "x-deadline": deadline, "idempotency-key": "key-1" },
    body: { title: "Plan" },
  };
}

const NO_DECLARED_HEADER: readonly string[] = [];

// The same vector as the Spring Boot target's `DigestsTest`, so a shared replay store sees one fingerprint.
const CREATE_TASK_FINGERPRINT = "8077418dab76b54fb536c8931896c2781fd2cbb0bb0e4a53e00f53131af694aa";

const DECLARED_HEADER_FINGERPRINT =
  "55783fe63deeec1c2b65e4f36cd854050ec43f7788e672472aa6f13a2db0ad55";

describe("the idempotency fingerprint", () => {
  test("a retry after a token refresh matches the first request", async () => {
    const first = await idempotencyFingerprint(
      CREATE_TASK,
      createTaskInput("Bearer user-old", "csrf-old"),
      NO_DECLARED_HEADER,
    );
    const retry = await idempotencyFingerprint(
      CREATE_TASK,
      createTaskInput("Bearer user-refreshed", "csrf-refreshed"),
      NO_DECLARED_HEADER,
    );

    expect(retry).toBe(first);
    expect(first).toBe(CREATE_TASK_FINGERPRINT);
  });

  test("a retry with a new trace id or deadline matches the first request", async () => {
    const first = await idempotencyFingerprint(
      CREATE_TASK,
      createTaskInputWithDerivedHeaders("00-trace-old-01", "2026-10-25T10:00:00Z"),
      NO_DECLARED_HEADER,
    );
    const retry = await idempotencyFingerprint(
      CREATE_TASK,
      createTaskInputWithDerivedHeaders("00-trace-new-01", "2026-10-25T10:00:05Z"),
      NO_DECLARED_HEADER,
    );

    expect(retry).toBe(first);
  });

  test("an author-declared header param stays in the fingerprint", async () => {
    const input = {
      path: { channelId: "c1" },
      query: {},
      headers: {
        "x-request-source": "mobile",
        traceparent: "00-trace-01",
        "idempotency-key": "key-1",
      },
      body: { title: "Plan" },
    };

    const fingerprint = await idempotencyFingerprint(CREATE_TASK, input, ["x-request-source"]);

    expect(fingerprint).toBe(DECLARED_HEADER_FINGERPRINT);
  });
});
