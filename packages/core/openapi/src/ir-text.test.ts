import { describe, expect, it } from "vitest";
import { originKey } from "./ir-text.js";

// An origin as the extensions write it (ADR 0004 section 12).

describe("origin keys", () => {
  it("leads an origin copied from another api with that api and '#', apart from a pack layer", () => {
    expect(originKey({ layer: "pack:api", pointer: "/x" })).toBe("pack:api#/x");
    expect(originKey({ api: "pack", layer: "api", pointer: "/x" })).toBe("pack#api#/x");
  });
});
