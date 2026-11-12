import type { ExpectedFiles } from "./expected.ts";

// The first difference between the expected files of a fixture and the compiled ones.

const CONTEXT_LINES = 3;

export interface Mismatch {
  file: string;
  /** The JSON Pointer of the first differing value, absent when a file is missing or extra. */
  pointer?: string;
  /** What differs, in one line. */
  summary: string;
  /** The expected and the actual lines around the first differing line. */
  expectedContext: string[];
  actualContext: string[];
}

const escapePointerSegment = (key: string): string =>
  key.replaceAll("~", "~0").replaceAll("/", "~1");

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

/** The pointer of the first value, in document order, where two JSON values differ; undefined when equal. */
export function firstDifferingPointer(
  expected: unknown,
  actual: unknown,
  pointer = "",
): string | undefined {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const common = Math.min(expected.length, actual.length);

    for (let index = 0; index < common; index++) {
      const found = firstDifferingPointer(expected[index], actual[index], `${pointer}/${index}`);

      if (found !== undefined) return found;
    }

    return expected.length === actual.length ? undefined : `${pointer}/${common}`;
  }

  if (isObject(expected) && isObject(actual) && !Array.isArray(expected) && !Array.isArray(actual))
    return firstDifferingObjectPointer(expected, actual, pointer);

  return Object.is(expected, actual) ? undefined : pointer;
}

function firstDifferingObjectPointer(
  expected: object,
  actual: object,
  pointer: string,
): string | undefined {
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  const common = Math.min(expectedKeys.length, actualKeys.length);

  for (let index = 0; index < common; index++) {
    const key = expectedKeys[index] ?? "";
    const at = `${pointer}/${escapePointerSegment(key)}`;

    // A different key at the same position: the order of members is output, so it is the difference.
    if (key !== actualKeys[index]) return at;

    const found = firstDifferingPointer(Reflect.get(expected, key), Reflect.get(actual, key), at);

    if (found !== undefined) return found;
  }

  if (expectedKeys.length === actualKeys.length) return undefined;

  return `${pointer}/${escapePointerSegment(expectedKeys[common] ?? actualKeys[common] ?? "")}`;
}

function contextAround(lines: string[], index: number): string[] {
  const first = Math.max(0, index - CONTEXT_LINES);

  return lines
    .slice(first, index + CONTEXT_LINES + 1)
    .map((line, offset) => `${String(first + offset + 1).padStart(6)} ${line}`);
}

function textMismatch(file: string, expected: string, actual: string): Mismatch {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  let index = 0;

  while (index < expectedLines.length && expectedLines[index] === actualLines[index]) index++;

  const pointer = firstDifferingPointer(JSON.parse(expected), JSON.parse(actual));

  return {
    file,
    ...(pointer === undefined ? {} : { pointer: pointer === "" ? "(root)" : pointer }),
    summary:
      pointer === undefined
        ? "the text differs and the parsed JSON values are equal (formatting or number notation)"
        : `the value at ${pointer === "" ? "the root" : pointer} differs`,
    expectedContext: contextAround(expectedLines, index),
    actualContext: contextAround(actualLines, index),
  };
}

/** The first mismatch in file name order, or undefined when the two sets of files are the same bytes. */
export function firstMismatch(
  expected: ExpectedFiles,
  actual: ExpectedFiles,
): Mismatch | undefined {
  const names = [...new Set([...expected.keys(), ...actual.keys()])].sort();

  for (const file of names) {
    const expectedText = expected.get(file);
    const actualText = actual.get(file);

    if (expectedText === undefined)
      return {
        file,
        summary: "the compiler writes this file and no expected file exists",
        expectedContext: [],
        actualContext: [],
      };

    if (actualText === undefined)
      return {
        file,
        summary: "an expected file exists and the compiler no longer writes it",
        expectedContext: [],
        actualContext: [],
      };

    if (expectedText !== actualText) return textMismatch(file, expectedText, actualText);
  }

  return undefined;
}

export function printMismatch(fixturePath: string, mismatch: Mismatch): string {
  const lines = [`first mismatch: ${fixturePath}`, `  file: ${mismatch.file}`];

  if (mismatch.pointer !== undefined) lines.push(`  pointer: ${mismatch.pointer}`);
  lines.push(`  ${mismatch.summary}`);

  if (mismatch.expectedContext.length > 0)
    lines.push("  expected:", ...mismatch.expectedContext, "  actual:", ...mismatch.actualContext);

  return lines.join("\n");
}
