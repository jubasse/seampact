const SHOWN_KEY_LIMIT = 8;

// The tail of a fix that asks for a mapping: the keys it may hold; empty when none is known.
export function mappingKeysHint(keys: readonly string[]): string {
  if (keys.length === 0) return "";

  const shown = keys.slice(0, SHOWN_KEY_LIMIT).join(", ");

  return ` with the keys ${shown}${keys.length > SHOWN_KEY_LIMIT ? ", ..." : ""}`;
}
