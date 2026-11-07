import { describe, expect, test } from "vitest";
import { isKeptForReplay } from "./replay-retention.js";

const CREATED = 201;
const CONFLICT = 409;

function replyWith(status: number, cacheControl: string) {
  return {
    status,
    headers: [["Cache-Control", cacheControl]] as const,
    body: new Uint8Array(),
  };
}

describe("the replies an idempotency record keeps", () => {
  test("an error reply marked no-store is not kept for a replay", () => {
    expect(isKeptForReplay(replyWith(CONFLICT, "private, No-Store"))).toBe(false);
  });

  test("a success marked no-store is kept for a replay", () => {
    expect(isKeptForReplay(replyWith(CREATED, "private, No-Store"))).toBe(true);
  });

  test("a reply without no-store is kept for a replay", () => {
    expect(isKeptForReplay(replyWith(CREATED, "private"))).toBe(true);
  });

  test("a server error is not kept for a replay", () => {
    expect(isKeptForReplay({ status: 503, headers: [] })).toBe(false);
  });
});
