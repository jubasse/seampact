import type { Param } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import {
  type FingerprintRoute,
  idempotencyFingerprint,
} from "../../node-server-runtime/idempotency-fingerprint.js";
import { fingerprintHeaderNames } from "./fingerprint-headers.js";

const CREATE_EVENT: FingerprintRoute = {
  method: "post",
  path: "/v1/events",
  access: { kind: "public" },
};

function derivedHeader(name: string, derivation: string): Param {
  return {
    name,
    required: true,
    type: { kind: "scalar", type: "string", refinements: {} },
    derivedFrom: { derivation, from: [{ layer: "api", pointer: "/schemas/Event" }] },
  };
}

// A header-tagged union: the tag selects the body variant, and two variants may share a body.
const EVENT_HEADERS: readonly Param[] = [
  derivedHeader("X-Event-Kind", "union.headerTag"),
  derivedHeader("traceparent", "identity.header"),
];

function eventInput(eventKind: string, traceparent: string): unknown {
  return {
    path: {},
    query: {},
    headers: { "x-event-kind": eventKind, traceparent },
    body: { title: "Plan" },
  };
}

describe("the header params a fingerprint digests", () => {
  test("a retry with the same body and another union tag does not match", async () => {
    const counted = fingerprintHeaderNames(EVENT_HEADERS);

    const first = await idempotencyFingerprint(
      CREATE_EVENT,
      eventInput("created", "00-trace-old-01"),
      counted,
    );
    const retry = await idempotencyFingerprint(
      CREATE_EVENT,
      eventInput("archived", "00-trace-new-01"),
      counted,
    );
    const sameTagRetry = await idempotencyFingerprint(
      CREATE_EVENT,
      eventInput("created", "00-trace-new-01"),
      counted,
    );

    expect(retry).not.toBe(first);
    expect(sameTagRetry).toBe(first);
  });
});
