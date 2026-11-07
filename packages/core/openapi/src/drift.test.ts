import { describe, expect, it } from "vitest";
import { findDocumentDrift } from "./drift.js";

describe("drift names the first differing line", () => {
  const committed = "openapi: 3.1.0\ninfo:\n  title: tasks\n";

  it("finds none in an equal pair", () => {
    expect(findDocumentDrift(committed, committed)).toBeUndefined();
  });

  it("names the line of a one-byte change, with both texts", () => {
    expect(findDocumentDrift(committed, "openapi: 3.1.0\ninfo:\n  title: tasKs\n")).toEqual({
      line: 3,
      committed: "  title: tasks",
      emitted: "  title: tasKs",
    });
  });

  it("names the first line one document lacks", () => {
    expect(findDocumentDrift("a\n", "a\nb\n")).toEqual({ line: 2, committed: "", emitted: "b" });
    expect(findDocumentDrift("a\nb", "a\n")).toEqual({ line: 2, committed: "b", emitted: "" });
  });
});
