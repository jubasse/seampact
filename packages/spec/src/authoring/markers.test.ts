import { expect, test } from "vitest";
import { EDITOR_TITLES, isMarker, MARKERS } from "./markers.js";
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

// A title is either a marker the validate stage converts by, or an editor-only label: a new title
// is a decision, made in markers.ts.
test("every title in the generated schemas is a marker or an editor title", () => {
  const found = new Set<string>();
  for (const file of AUTHORING_FILES) {
    const { title: _fileTitle, ...below } = authoringSchemas()[file] as Record<string, unknown>;
    titles(below, found);
  }
  const known = new Set<string>([...Object.values(MARKERS), ...EDITOR_TITLES]);
  expect([...found].filter((t) => !known.has(t)).sort()).toEqual([]);
  expect(EDITOR_TITLES.filter((t) => !found.has(t))).toEqual([]);
  expect(EDITOR_TITLES.filter(isMarker)).toEqual([]);
});

test("markers are distinct and recognised", () => {
  const values = Object.values(MARKERS);
  expect(new Set(values).size).toBe(values.length);
  expect(values.every(isMarker)).toBe(true);
  expect(isMarker("path")).toBe(false);
});
