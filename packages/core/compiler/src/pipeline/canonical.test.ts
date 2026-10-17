import { expect, test } from "vitest";
import { canonical } from "./canonical.js";
import * as seam from "./seam.js";

test("two objects written in another key order have one canonical text, at any depth", () => {
  expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
  expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
});

test("array order is kept and the objects inside an array are sorted", () => {
  expect(canonical([{ b: 1, a: 2 }, 3])).toBe('[{"a":2,"b":1},3]');
  expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
});

test("scalars and null are their JSON text", () => {
  expect(canonical(null)).toBe("null");
  expect(canonical("x")).toBe('"x"');
});

test("the seam barrel exports the same function", () => {
  expect(seam.pipelineCanonical).toBe(canonical);
});
