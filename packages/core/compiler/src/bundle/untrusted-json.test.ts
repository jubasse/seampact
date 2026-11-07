import { expect, test } from "vitest";
import { duplicateKeyPointer, parseUntrustedJson, utf8Text } from "./untrusted-json.js";

test("a key given twice in one object is found by its pointer", () => {
  expect(duplicateKeyPointer('{"a": 1, "b": {"c": [1, {"d": 1}]}}')).toBeUndefined();
  expect(duplicateKeyPointer('{"a": {"x": 1}, "b": {"x": 1}}')).toBeUndefined();
  expect(duplicateKeyPointer('{"a": 1, "a": 2}')).toBe("/a");
  expect(duplicateKeyPointer('{"a": [0, {"k\\"/": 1, "k\\u0022/": 2}]}')).toBe('/a/1/k"~1');
  expect(duplicateKeyPointer('["{\\"a\\": 1, \\"a\\": 2}"]')).toBeUndefined();
});

test("a byte order mark is refused, not dropped", () => {
  const text = utf8Text(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));

  expect(text === undefined ? undefined : parseUntrustedJson(text)).toEqual({
    ok: false,
    problem: "starts with a byte order mark (U+FEFF)",
  });
});
