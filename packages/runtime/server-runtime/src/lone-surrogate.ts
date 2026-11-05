// A string value holding a lone surrogate is not Unicode text; the request body is refused, as PHP and Python do.
// A key keeps it, for the unknown-key report.

/** Whether a string value anywhere in a parsed JSON tree holds a lone surrogate. */
export function holdsLoneSurrogate(tree: unknown): boolean {
  const pending: unknown[] = [tree];

  while (pending.length > 0) {
    const item = pending.pop();

    if (typeof item === "string" && !item.isWellFormed()) return true;

    if (Array.isArray(item)) pending.push(...item);
    else if (typeof item === "object" && item !== null) pending.push(...Object.values(item));
  }

  return false;
}
