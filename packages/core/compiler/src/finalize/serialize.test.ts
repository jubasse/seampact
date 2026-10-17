import { readFileSync } from "node:fs";
import type { ContractIR } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import { finalizeSerializeIr, finalizeSerializeJson } from "./serialize.js";

const MINIMAL_IR: ContractIR = JSON.parse(
  readFileSync(
    new URL("../../../spec/schemas/ir/examples/minimal.ir.json", import.meta.url),
    "utf8",
  ),
);

// The same members in reverse order, rebuilt at every depth.
function reversedMembers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedMembers);

  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, member]) => [key, reversedMembers(member)]),
  );
}

describe("byte-stable serialisation", () => {
  test("members sort by UTF-16 code units, integer-like names included", () => {
    const text = finalizeSerializeJson({
      b: 1,
      "9": 2,
      a: 3,
      "10": 4,
      Z: 5,
      é: 6,
      "\u{1F600}": 7,
      "�": 8,
    });

    expect(text).toBe(
      '{\n  "10": 4,\n  "9": 2,\n  "Z": 5,\n  "a": 3,\n  "b": 1,\n  "é": 6,\n  "\u{1F600}": 7,\n  "�": 8\n}\n',
    );
  });

  test("strings are escaped as RFC 8785 does", () => {
    const text = finalizeSerializeJson([
      'q"\\/',
      "\b\f\n\r\t",
      "\u0001\u001f\u007f",
      "é\u{1F600} ",
    ]);

    expect(text).toBe(
      '[\n  "q\\"\\\\/",\n  "\\b\\f\\n\\r\\t",\n  "\\u0001\\u001f\u007f",\n  "é\u{1F600} "\n]\n',
    );
  });

  test("numbers are written as RFC 8785 does", () => {
    const text = finalizeSerializeJson([
      0, -0, 9007199254740991, -9007199254740991, 1e21, 1e-7, 0.1, -1.5,
    ]);

    expect(text).toBe(
      "[\n  0,\n  0,\n  9007199254740991,\n  -9007199254740991,\n  1e+21,\n  1e-7,\n  0.1,\n  -1.5\n]\n",
    );
  });

  test("empty and nested values use two-space indentation, LF and a final newline", () => {
    const text = finalizeSerializeJson({
      list: [[], {}],
      nested: { empty: {} },
      flags: [true, false, null],
    });

    expect(text).toBe(
      '{\n  "flags": [\n    true,\n    false,\n    null\n  ],\n  "list": [\n    [],\n    {}\n  ],\n  "nested": {\n    "empty": {}\n  }\n}\n',
    );
    expect(text.includes("\r")).toBe(false);
    expect(text.startsWith("﻿")).toBe(false);
  });

  test("a catalogue without a prototype keeps its __proto__ member", () => {
    const catalogue = Object.create(null);

    Object.defineProperty(catalogue, "__proto__", { value: 1, enumerable: true });

    expect(finalizeSerializeJson(catalogue)).toBe('{\n  "__proto__": 1\n}\n');
  });

  test("the same IR built in two member orders gives the same bytes", () => {
    const reversed = reversedMembers(MINIMAL_IR);

    expect(JSON.stringify(reversed)).not.toBe(JSON.stringify(MINIMAL_IR));
    expect(finalizeSerializeJson(reversed)).toBe(finalizeSerializeIr(MINIMAL_IR));
  });

  test.each([
    {
      name: "a number that is not finite",
      value: { a: [Number.NaN] },
      failure: "the number NaN at '/a/0'",
    },
    {
      name: "an infinite number",
      value: { a: Number.POSITIVE_INFINITY },
      failure: "the number Infinity at '/a'",
    },
    {
      name: "a lone surrogate",
      value: { "a/b": "\uD800" },
      failure: "a lone surrogate at '/a~1b'",
    },
    {
      name: "a lone surrogate in a name",
      value: { "\uDC00": 1 },
      failure: "a lone surrogate at '/\uDC00'",
    },
    {
      name: "an undefined member",
      value: { a: undefined },
      failure: "a value of type undefined at '/a'",
    },
    {
      name: "an object that is no data",
      value: { a: new Map() },
      failure: "an object that is not plain data at '/a'",
    },
  ])("$name is refused, named by its pointer", ({ value, failure }) => {
    expect(() => finalizeSerializeJson(value)).toThrow(failure);
  });
});
