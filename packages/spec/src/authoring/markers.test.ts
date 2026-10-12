import { expect, test } from "vitest";
import { DATA, EDITOR_TITLES, isMarker, MARKERS } from "./markers.js";
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
  const known = new Set<string>([...Object.values(MARKERS), ...EDITOR_TITLES, DATA]);
  expect([...found].filter((t) => !known.has(t)).sort()).toEqual([]);
  expect(EDITOR_TITLES.filter((t) => !found.has(t))).toEqual([]);
  expect(EDITOR_TITLES.filter(isMarker)).toEqual([]);
  expect(isMarker(DATA) || EDITOR_TITLES.includes(DATA)).toBe(false);
});

test("markers are distinct and recognised", () => {
  const values = Object.values(MARKERS);
  expect(new Set(values).size).toBe(values.length);
  expect(values.every(isMarker)).toBe(true);
  expect(isMarker("path")).toBe(false);
});

function dataPointers(node: unknown, where: string, out: string[]): string[] {
  if (Array.isArray(node)) {
    for (const [i, child] of node.entries()) dataPointers(child, `${where}/${i}`, out);
  } else if (node !== null && typeof node === "object") {
    if ((node as Record<string, unknown>).title === DATA) out.push(where);
    for (const [key, child] of Object.entries(node)) {
      if (key !== "title") dataPointers(child, `${where}/${key}`, out);
    }
  }
  return out;
}

// The data positions are marked, never inferred (ADR 0002 section 2): a payload, an example, a
// default. Adding one is a grammar decision, seen here.
test("the data positions are the ones marked DATA", () => {
  const found: string[] = [];
  for (const file of AUTHORING_FILES) dataPointers(authoringSchemas()[file], file, found);
  expect(found.sort()).toEqual([
    "errors/$defs/entry/properties/example",
    "node-errors/$defs/attachment/else/properties/example",
    "node-errors/$defs/attachment/then/properties/example",
    "node/$defs/examples/additionalProperties/properties/value",
    "schema/$defs/derived/properties/examples/items",
    "schema/$defs/overlay/properties/default",
    "schema/$defs/overlay/properties/examples/items",
    "schema/$defs/plain/properties/default",
    "schema/$defs/plain/properties/examples/items",
    "schema/$defs/referenceMapping/properties/default",
    "schema/$defs/referenceMapping/properties/examples/items",
  ]);
});
