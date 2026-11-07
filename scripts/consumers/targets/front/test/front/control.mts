// The script loader of the browser tests: drives the server's http suite control routes through the same-origin
// proxy, at the routes the config provides, as the suite does over HTTP.
import type { RecordedHookCall, SampleAppScript } from "@seampact/http-suite";
import { inject } from "vitest";
import "./provided.mjs";

/** Loads the script the server's hooks and handlers answer from, and starts recording hook calls. */
export async function loadScript(script: SampleAppScript): Promise<void> {
  const response = await fetch(inject("controlRoutes").script, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(script),
  });

  if (!response.ok) {
    throw new Error(
      `front: loading the script answered ${response.status}: ${await response.text()}`,
    );
  }
}

/** The hook calls the server recorded since the last script load. */
export async function recordedHookCalls(): Promise<RecordedHookCall[]> {
  const response = await fetch(inject("controlRoutes").hookCalls);
  const reply: unknown = await response.json();

  if (!response.ok || !isHookCallsReply(reply)) {
    throw new Error(`front: reading the hook calls answered ${response.status}.`);
  }

  return reply.calls;
}

function isHookCallsReply(value: unknown): value is { calls: RecordedHookCall[] } {
  if (typeof value !== "object" || value === null || !("calls" in value)) return false;

  return Array.isArray(value.calls) && value.calls.every(isRecordedHookCall);
}

function isRecordedHookCall(value: unknown): value is RecordedHookCall {
  return (
    typeof value === "object" &&
    value !== null &&
    "hook" in value &&
    typeof value.hook === "string" &&
    "operation" in value &&
    typeof value.operation === "string"
  );
}
