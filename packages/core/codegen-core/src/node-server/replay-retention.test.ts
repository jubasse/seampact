import { describe, expect, test } from "vitest";
import { isKeptForReplay } from "../../node-server-runtime/replay-retention.js";

function createdReply(cacheControl: string) {
  return {
    status: 201,
    headers: [["Cache-Control", cacheControl]] as const,
    body: new Uint8Array(),
  };
}

describe("the replies an idempotency record keeps", () => {
  test("a reply marked no-store is not kept for a replay", () => {
    expect(isKeptForReplay(createdReply("private, No-Store"))).toBe(false);
  });

  test("a reply without no-store is kept for a replay", () => {
    expect(isKeptForReplay(createdReply("private"))).toBe(true);
  });

  test("a server error is not kept for a replay", () => {
    expect(isKeptForReplay({ status: 503, headers: [] })).toBe(false);
  });
});
