// Whether a parsed JSON tree holds a lone surrogate, in a string value or a key, which is not Unicode text.

import { isPlainObject } from "./plain-object.js";

/** Whether a string anywhere in a parsed JSON tree, a key included, holds a lone surrogate. */
export function holdsLoneSurrogate(tree: unknown): boolean {
  const pending: unknown[] = [tree];

  while (pending.length > 0) {
    const item = pending.pop();

    if (typeof item === "string" && !item.isWellFormed()) return true;

    if (Array.isArray(item)) {
      for (const child of item) pending.push(child);
    } else if (isPlainObject(item)) {
      for (const [key, child] of Object.entries(item)) {
        if (!key.isWellFormed()) return true;

        pending.push(child);
      }
    }
  }

  return false;
}
