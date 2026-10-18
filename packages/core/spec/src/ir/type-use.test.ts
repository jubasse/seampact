import { expect, test } from "vitest";
import { isIrSameTypeUse } from "./type-use.js";

const text = { kind: "scalar", type: "string", refinements: { minLength: 1 } };

test("type uses differing only in docs, examples, origin or a reason, at any depth, are the same", () => {
  const items = (docs: object) => ({ kind: "array", items: { ...text, docs }, examples: [["a"]] });

  expect(isIrSameTypeUse(items({ summary: "One." }), items({ summary: "Two." }))).toBe(true);
  expect(
    isIrSameTypeUse(
      { kind: "enum", enum: "State", narrowedTo: { values: ["open"], reason: "Open only." } },
      { narrowedTo: { reason: "Still open.", values: ["open"] }, enum: "State", kind: "enum" },
    ),
  ).toBe(true);
  expect(
    isIrSameTypeUse(
      { kind: "ref", schema: "Task", origin: { layer: "api", pointer: "/a" } },
      { kind: "ref", schema: "Task", origin: { layer: "api", pointer: "/b" } },
    ),
  ).toBe(true);

  const nested = (reason: string, values: string[]) => ({
    kind: "array",
    items: { kind: "array", items: { kind: "enum", enum: "State", narrowedTo: { values, reason } } },
  });

  expect(isIrSameTypeUse(nested("Open.", ["open"]), nested("Still open.", ["open"]))).toBe(true);
  expect(isIrSameTypeUse(nested("Open.", ["open"]), nested("Open.", ["closed"]))).toBe(false);
});

test("type uses differing in what they accept are not the same", () => {
  expect(isIrSameTypeUse(text, { ...text, refinements: { minLength: 2 } })).toBe(false);
  expect(isIrSameTypeUse(text, { ...text, nullable: true })).toBe(false);
  expect(isIrSameTypeUse(text, { ...text, format: "uuid" })).toBe(false);
  expect(
    isIrSameTypeUse(
      { kind: "enum", enum: "State", narrowedTo: { values: ["open"], reason: "Open." } },
      { kind: "enum", enum: "State", narrowedTo: { values: ["closed"], reason: "Open." } },
    ),
  ).toBe(false);
});
