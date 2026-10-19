import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sha256Base64Url, sha256Hex } from "../../node-server-runtime/sha256.js";

// Inputs whose base64url digest holds `-` or `_`, and bytes that are not UTF-8.
const TEXT_INPUTS = ["", "abc", '["tasks","perUser",["u-1"]]', "é€😀"];
const BYTE_INPUTS = [new Uint8Array(), new Uint8Array([0, 255, 128, 10]), Buffer.from("a buffer")];

describe("sha256 on Web Crypto", () => {
  test.each(TEXT_INPUTS)("hex of %j equals node:crypto", async (text) => {
    expect(await sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
  });

  test.each(BYTE_INPUTS)("base64url of bytes %# equals node:crypto", async (bytes) => {
    expect(await sha256Base64Url(bytes)).toBe(
      createHash("sha256").update(bytes).digest("base64url"),
    );
  });

  test("base64url covers the url-safe characters", async () => {
    const digests = await Promise.all(
      Array.from({ length: 64 }, (_, index) => sha256Base64Url(String(index))),
    );

    for (const [index, digest] of digests.entries()) {
      expect(digest).toBe(createHash("sha256").update(String(index)).digest("base64url"));
    }

    expect(digests.join("")).toMatch(/[-_]/);
  });
});
