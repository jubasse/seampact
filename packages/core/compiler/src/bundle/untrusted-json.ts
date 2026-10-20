import { RESERVED_NAMES } from "@seampact/spec/authoring";
import { pipelinePointerBelow } from "../pipeline/seam.js";

// A bundle's JSON comes from the network: parsed, then refused when any key reaches a JavaScript object's
// prototype, before a schema or a reader sees it.

export type UntrustedJson = { ok: true; value: unknown } | { ok: false; problem: string };

const RESERVED_KEYS: ReadonlySet<string> = new Set(RESERVED_NAMES);

/** The parsed text, or why it is refused: not JSON, or a reserved key with its JSON Pointer. */
export function parseUntrustedJson(text: string): UntrustedJson {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      problem: `is not JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  const reservedAt = reservedKeyPointer(value);

  if (reservedAt !== undefined)
    return { ok: false, problem: `holds the reserved key at '${reservedAt}'` };

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

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The UTF-8 text of `bytes`, or undefined when they are not UTF-8. */
export function utf8Text(bytes: Uint8Array): string | undefined {
  try {
    return STRICT_UTF8.decode(bytes);
  } catch {
    // The caller names the file that is not UTF-8.
    return undefined;
  }
}
