import { RESERVED_NAMES } from "@seampact/spec/authoring";
import { pipelinePointerBelow } from "../pipeline/seam.js";
import { quote } from "../validate/diagnostics.js";

// A bundle's JSON comes from the network: refused when it starts with a byte order mark (a strict JSON reader
// refuses one), parsed, then refused when any key reaches a JavaScript object's prototype, before a schema or a
// reader sees it. Its text and keys are quoted in every message.

export type UntrustedJson = { ok: true; value: unknown } | { ok: false; problem: string };

const RESERVED_KEYS: ReadonlySet<string> = new Set(RESERVED_NAMES);
const BYTE_ORDER_MARK = "\uFEFF";

/** The parsed text, or why it is refused: not JSON, or a reserved key with its JSON Pointer. */
export function parseUntrustedJson(text: string): UntrustedJson {
  if (text.startsWith(BYTE_ORDER_MARK))
    return { ok: false, problem: "starts with a byte order mark (U+FEFF)" };

  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      problem: `is not JSON (${quote(error instanceof Error ? error.message : String(error))})`,
    };
  }

  const reservedAt = reservedKeyPointer(value);

  if (reservedAt !== undefined)
    return { ok: false, problem: `holds the reserved key at ${quote(reservedAt)}` };

  return { ok: true, value };
}

// Iterative: a hostile document may nest deeper than the call stack.
function reservedKeyPointer(root: unknown): string | undefined {
  const pending: { value: unknown; pointer: string }[] = [{ value: root, pointer: "" }];

  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { value, pointer } = next;

    if (typeof value !== "object" || value === null) continue;

    for (const [key, member] of Object.entries(value)) {
      const at = pipelinePointerBelow(pointer, key);

      if (!Array.isArray(value) && RESERVED_KEYS.has(key)) return at;

      pending.push({ value: member, pointer: at });
    }
  }

  return undefined;
}

// The byte order mark is kept, so the caller refuses it.
interface ScanFrame {
  readonly pointer: string;
  /** The keys seen so far; undefined in an array. */
  readonly keys?: Set<string>;
  key?: string;
  index: number;
}

/**
 * The JSON Pointer of the first key given twice in one object of `text`, which `JSON.parse` already accepted;
 * undefined when every key is given once. Iterative: a hostile document may nest deeper than the call stack.
 */
export function duplicateKeyPointer(text: string): string | undefined {
  const stack: ScanFrame[] = [];
  let expectingKey = false;

  for (let at = 0; at < text.length; at++) {
    const character = text[at];
    const top = stack.at(-1);

    if (character === '"') {
      const end = stringEnd(text, at);
      const decoded: unknown = JSON.parse(text.slice(at, end + 1));

      at = end;

      if (!expectingKey || top?.keys === undefined || typeof decoded !== "string") continue;

      if (top.keys.has(decoded)) return pipelinePointerBelow(top.pointer, decoded);

      top.keys.add(decoded);
      top.key = decoded;
      expectingKey = false;
    } else if (character === "{" || character === "[") {
      const pointer = top === undefined ? "" : childPointer(top);

      stack.push(
        character === "{" ? { pointer, keys: new Set(), index: 0 } : { pointer, index: 0 },
      );
      expectingKey = character === "{";
    } else if (character === "}" || character === "]") {
      stack.pop();
    } else if (character === ",") {
      if (top !== undefined) top.index++;
      expectingKey = top?.keys !== undefined;
    }
  }

  return undefined;
}

function childPointer(frame: ScanFrame): string {
  return pipelinePointerBelow(
    frame.pointer,
    frame.keys === undefined ? String(frame.index) : (frame.key ?? ""),
  );
}

// The index of the quote that closes the string opened at `start`.
function stringEnd(text: string, start: number): number {
  for (let at = start + 1; at < text.length; at++) {
    if (text[at] === "\\") at++;
    else if (text[at] === '"') return at;
  }

  throw new Error("bundle: a JSON string accepted by JSON.parse has no closing quote.");
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** The UTF-8 text of `bytes`, or undefined when they are not UTF-8. */
export function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    // The caller names the file that is not UTF-8.
    return undefined;
  }
}
