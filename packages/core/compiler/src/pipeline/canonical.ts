// The canonical text of a JSON value, shared by the passes through the seam barrel.

/** A value's text with every object's keys sorted, so two equal values written in another key order are one. */
export function canonical(value: unknown): string {
  const sorted = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sorted);
    if (typeof item !== "object" || item === null) return item;
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, sorted(Reflect.get(item, key))]),
    );
  };
  return JSON.stringify(sorted(value));
}
