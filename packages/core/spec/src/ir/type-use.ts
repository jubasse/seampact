// Whether two type uses accept the same values (ADR 0004 section 5): equal once the members that say where and
// how a use is written, not what it accepts (`docs`, `examples`, `origin`, a narrowing's `reason`), are left out
// at every depth. The compiler's successor check and the invariant `ir.deprecation.headers` compare path params with it.

const ANNOTATION_MEMBERS: ReadonlySet<string> = new Set(["docs", "examples", "origin", "reason"]);

/** True when the two type uses differ in annotations only. */
export function isIrSameTypeUse(left: unknown, right: unknown): boolean {
  return canonicalWithoutAnnotations(left) === canonicalWithoutAnnotations(right);
}

// JSON text with object keys sorted and the annotation members left out.
function canonicalWithoutAnnotations(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalWithoutAnnotations).join(",")}]`;

  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "null";

  const members = Object.entries(value)
    .filter(([key, member]) => !ANNOTATION_MEMBERS.has(key) && member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalWithoutAnnotations(member)}`);

  return `{${members.join(",")}}`;
}
