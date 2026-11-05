import { expect, test } from "vitest";
import { holdsLoneSurrogate } from "./lone-surrogate.js";

const LONE = JSON.parse('"a\\ud800"') as string;

test.each([
  ["a string", LONE],
  ["a member value", { title: LONE }],
  ["a nested array item", { tags: [["ok", LONE]] }],
])("%s holding a lone surrogate is found", (_name, tree) => {
  expect(holdsLoneSurrogate(tree)).toBe(true);
});

test.each([
  ["a pair", "a\u{1F600}"],
  ["no string", { count: 1, flag: null }],
  ["a lone surrogate in a key", { [LONE]: 1 }],
  ["an empty body", undefined],
])("%s is accepted", (_name, tree) => {
  expect(holdsLoneSurrogate(tree)).toBe(false);
});
