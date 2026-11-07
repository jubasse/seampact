import { expect, test } from "vitest";
import { isJsonObject, jsonAtPointer, pointerBelow } from "./pointer.js";
import * as seam from "./seam.js";

const tree = { a: { "b/c": [10, { "~": true }] }, list: [1, 2] };

test("pointerBelow appends escaped segments and numbers", () => {
  expect(pointerBelow("/a")).toBe("/a");
  expect(pointerBelow("", "a", "b/c", 1)).toBe("/a/b~1c/1");
  expect(pointerBelow("/x", "~")).toBe("/x/~0");
});

test("jsonAtPointer reads members, unescapes segments and returns the root for an empty pointer", () => {
  expect(jsonAtPointer(tree, "")).toBe(tree);
  expect(jsonAtPointer(tree, "/a/b~1c/0")).toBe(10);
  expect(jsonAtPointer(tree, "/a/b~1c/1/~0")).toBe(true);
});

test("jsonAtPointer names nothing for a missing, inherited or relative pointer", () => {
  expect(jsonAtPointer(tree, "/missing")).toBeUndefined();
  expect(jsonAtPointer(tree, "/constructor")).toBeUndefined();
  expect(jsonAtPointer(tree, "a")).toBeUndefined();
});

test("jsonAtPointer takes a canonical array index only", () => {
  expect(jsonAtPointer(tree, "/list/1")).toBe(2);
  expect(jsonAtPointer(tree, "/list/01")).toBeUndefined();
  expect(jsonAtPointer(tree, "/list/-1")).toBeUndefined();
  expect(jsonAtPointer(tree, "/list/1.0")).toBeUndefined();
  expect(jsonAtPointer(tree, "/list/length")).toBeUndefined();
  expect(jsonAtPointer(tree, "/list/5")).toBeUndefined();
});

test("isJsonObject is true for a plain object only", () => {
  expect(isJsonObject({})).toBe(true);
  expect(isJsonObject([])).toBe(false);
  expect(isJsonObject(null)).toBe(false);
  expect(isJsonObject("x")).toBe(false);
  expect(isJsonObject(undefined)).toBe(false);
});

test("the seam barrel exports the same helpers under pipeline names", () => {
  expect(seam.pipelinePointerBelow).toBe(pointerBelow);
  expect(seam.pipelineJsonAtPointer).toBe(jsonAtPointer);
  expect(seam.pipelineIsJsonObject).toBe(isJsonObject);
});
