import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WIRE_CHECKS_SOURCE } from "./wire-checks.js";

const temporaryRoot = mkdtempSync(join(tmpdir(), "seampact-wire-checks-"));

let isIntegerMultiple: (value: number, integerStep: string) => boolean;

beforeAll(async () => {
  const modulePath = join(temporaryRoot, "wire-checks.ts");

  writeFileSync(modulePath, WIRE_CHECKS_SOURCE);
  ({ isIntegerMultiple } = await import(modulePath));
});

afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));

describe("the exact integer multiple check of the generated wire checks", () => {
  test.each([
    [9114, "7", true],
    [9113, "7", false],
    [9007199254740988, "7", true],
    [9007199254740987, "7", false],
    [-9, "3", true],
    [0, "5", true],
  ])("%s is a multiple of the integer step %s: %s", (value, integerStep, expected) => {
    expect(isIntegerMultiple(value, integerStep)).toBe(expected);
  });

  test("a value that is no integer is left to the integer check", () => {
    expect(isIntegerMultiple(1.5, "7")).toBe(true);
  });
});
