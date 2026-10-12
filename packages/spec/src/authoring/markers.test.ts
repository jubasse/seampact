import { expect, test } from "vitest";
import { isMarker, MARKERS } from "./markers.js";
import { AUTHORING_FILES, authoringSchemas } from "./schemas.js";

function titles(node: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(node)) for (const child of node) titles(child, out);
  else if (node !== null && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      // `title` as a schema keyword, not a property named `title` under `properties`.
      if (key === "title" && typeof child === "string") out.add(child);
      else titles(child, out);
    }
  }
  return out;
}

// The validate stage converts errors by these titles: each must still be written by the grammar.
test("every marker the validate stage relies on appears in the generated schemas", () => {
  const found = new Set<string>();
  for (const file of AUTHORING_FILES) titles(authoringSchemas()[file], found);
  expect(Object.values(MARKERS).filter((m) => !found.has(m))).toEqual([]);
});

test("markers are distinct and recognised", () => {
  const values = Object.values(MARKERS);
  expect(new Set(values).size).toBe(values.length);
  expect(values.every(isMarker)).toBe(true);
  expect(isMarker("path")).toBe(false);
});
