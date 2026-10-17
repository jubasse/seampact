import type { ContractIR } from "@seampact/spec/ir";
import { pipelinePointerBelow } from "../pipeline/seam.js";

// The byte-stable text of the IR (ADR 0004 section 10): members sorted by the UTF-16 code units of their names,
// two-space indentation, LF line endings and a final newline, strings and numbers as RFC 8785 writes them. The
// caller writes it as UTF-8 with no byte order mark. The members are written in order as text: rebuilding a
// sorted object would not do, since an object lists integer-like keys ("10", "9") before every other key.

const INDENT = "  ";

// A lone surrogate has no UTF-8 form, so RFC 8785 refuses it rather than escaping it.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/** The IR file text: the same IR value gives the same text, whatever order its members were written in. */
export function finalizeSerializeIr(ir: ContractIR): string {
  return finalizeSerializeJson(ir);
}

/** Any JSON document written as the IR is, such as its side table (ADR 0004 section 11). */
export function finalizeSerializeJson(value: unknown): string {
  return `${serializedValue(value, "", "")}\n`;
}

function serializedValue(value: unknown, pointer: string, indent: string): string {
  if (value === null || typeof value === "boolean") return String(value);

  if (typeof value === "number") return serializedNumber(value, pointer);

  if (typeof value === "string") return serializedString(value, pointer);

  if (Array.isArray(value)) return serializedArray(value, pointer, indent);

  if (typeof value === "object") return serializedObject(value, pointer, indent);

  throw notSerializable(`a value of type ${typeof value}`, pointer);
}

function serializedNumber(value: number, pointer: string): string {
  if (!Number.isFinite(value)) throw notSerializable(`the number ${value}`, pointer);

  // ECMAScript's shortest round-trip form is RFC 8785's; it writes -0 as 0.
  return JSON.stringify(value);
}

function serializedString(value: string, pointer: string): string {
  if (LONE_SURROGATE.test(value)) throw notSerializable("a lone surrogate", pointer);

  return JSON.stringify(value);
}

function serializedArray(items: readonly unknown[], pointer: string, indent: string): string {
  if (items.length === 0) return "[]";
  const inner = indent + INDENT;
  const lines = items.map(
    (item, index) => inner + serializedValue(item, pipelinePointerBelow(pointer, index), inner),
  );

  return `[\n${lines.join(",\n")}\n${indent}]`;
}

function serializedObject(value: object, pointer: string, indent: string): string {
  const prototype: unknown = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null)
    throw notSerializable("an object that is not plain data", pointer);

  // The default sort compares UTF-16 code units, the member order of RFC 8785.
  const keys = Object.keys(value).sort();

  if (keys.length === 0) return "{}";
  const inner = indent + INDENT;
  const lines = keys.map((key) => {
    const at = pipelinePointerBelow(pointer, key);
    const member: unknown = Reflect.get(value, key);

    return `${inner}${serializedString(key, at)}: ${serializedValue(member, at, inner)}`;
  });

  return `{\n${lines.join(",\n")}\n${indent}}`;
}

function notSerializable(what: string, pointer: string): Error {
  return new Error(
    `finalize cannot serialise ${what} at '${pointer}': the IR holds JSON data only, written by a pass.`,
  );
}
