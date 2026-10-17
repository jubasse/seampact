import { describe, expect, test } from "vitest";
import { grammarKeywords } from "./grammar.js";
import { formatSchemaJson } from "./json.js";

// SM-6: adding or removing a keyword changes the snapshot, which `vitest run -u` rewrites from the
// keyword's ADR reference; a keyword without one fails here first.
describe("grammar snapshot", () => {
  const grammar = grammarKeywords();

  test("every keyword names the ADR section that defines it", () => {
    expect(grammar.unreferenced).toEqual([]);
  });

  test("the keyword set matches the committed snapshot", async () => {
    await expect(formatSchemaJson(grammar.mappings)).toMatchFileSnapshot("grammar.snapshot.json");
  });
});
