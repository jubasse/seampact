// Checks one received response against a step's expectation and answers every mismatch as a sentence.
import type { HeaderExpectation, JsonValue, StepExpectation } from "./suite-case.js";

/** A response as the runner read it: the body text, and its JSON value when the text parses. */
export interface ReceivedResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly json: JsonValue | undefined;
}

const ARRAY_INDEX = /^(?:0|[1-9]\d*)$/;

export function checkResponse(expectation: StepExpectation, response: ReceivedResponse): string[] {
  const failures: string[] = [];

  if (response.status !== expectation.status) {
    failures.push(
      `status ${response.status}, expected ${expectation.status}; body: ${response.text}`,
    );
  }

  for (const [name, headerExpectation] of Object.entries(expectation.headers ?? {})) {
    failures.push(...checkHeader(name, headerExpectation, response.headers.get(name)));
  }

  if (expectation.bodyText !== undefined && response.text !== expectation.bodyText) {
    failures.push(
      `body text ${JSON.stringify(response.text)}, expected ${JSON.stringify(expectation.bodyText)}`,
    );
  }

  if (expectation.body !== undefined) failures.push(...checkBody(expectation.body, response));

  failures.push(...checkAbsent(expectation.absent ?? [], response));

  return failures;
}

function checkAbsent(pointers: readonly string[], response: ReceivedResponse): string[] {
  if (pointers.length === 0) return [];

  if (response.json === undefined) return [`body is not JSON: ${JSON.stringify(response.text)}`];

  return pointers.flatMap((pointer) => {
    const actual = readPointer(response.json ?? null, pointer);

    return actual === undefined
      ? []
      : [`body member '${pointer}' is ${JSON.stringify(actual)}, expected absent`];
  });
}

function checkHeader(name: string, expectation: HeaderExpectation, value: string | null): string[] {
  if (expectation.absent === true) {
    return value === null ? [] : [`header '${name}' is '${value}', expected absent`];
  }

  if (expectation.excludes !== undefined) {
    return value?.includes(expectation.excludes) === true
      ? [`header '${name}' is '${value}', expected without '${expectation.excludes}'`]
      : [];
  }

  if (value === null) return [`header '${name}' is absent`];

  if (expectation.equals !== undefined && value !== expectation.equals) {
    return [`header '${name}' is '${value}', expected '${expectation.equals}'`];
  }

  return (expectation.contains ?? [])
    .filter((part) => !value.includes(part))
    .map((part) => `header '${name}' is '${value}', expected to contain '${part}'`);
}

function checkBody(expected: JsonValue, response: ReceivedResponse): string[] {
  if (response.json === undefined) return [`body is not JSON: ${JSON.stringify(response.text)}`];

  return subsetMismatches(expected, response.json, "");
}

// Objects match member by member, arrays element by element with the same length, other values by equality.
function subsetMismatches(expected: JsonValue, actual: JsonValue, pointer: string): string[] {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      return [mismatch(pointer, expected, actual)];
    }

    return expected.flatMap((item, index) =>
      subsetMismatches(item, actual[index] ?? null, `${pointer}/${index}`),
    );
  }

  if (isJsonObject(expected)) {
    if (!isJsonObject(actual)) return [mismatch(pointer, expected, actual)];

    return Object.entries(expected).flatMap(([member, item]) => {
      const actualItem = Object.hasOwn(actual, member) ? actual[member] : undefined;

      return actualItem === undefined
        ? [`body member '${pointer}/${member}' is absent, expected ${JSON.stringify(item)}`]
        : subsetMismatches(item, actualItem, `${pointer}/${member}`);
    });
  }

  return expected === actual ? [] : [mismatch(pointer, expected, actual)];
}

function mismatch(pointer: string, expected: JsonValue, actual: JsonValue): string {
  return `body at '${pointer}' is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}

function isJsonObject(value: JsonValue): value is { readonly [member: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at a JSON pointer (RFC 6901), or `undefined` when the document holds none there. */
export function readPointer(document: JsonValue, pointer: string): JsonValue | undefined {
  if (pointer === "") return document;

  if (!pointer.startsWith("/")) return undefined;

  let current: JsonValue | undefined = document;

  for (const token of pointer.slice(1).split("/")) {
    const member = token.replaceAll("~1", "/").replaceAll("~0", "~");

    if (Array.isArray(current)) {
      current = ARRAY_INDEX.test(member) ? current[Number(member)] : undefined;
      continue;
    }

    if (current === undefined || !isJsonObject(current)) return undefined;

    current = Object.hasOwn(current, member) ? current[member] : undefined;
  }

  return current;
}
