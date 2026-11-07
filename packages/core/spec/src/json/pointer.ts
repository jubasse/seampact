// JSON Pointer segments (RFC 6901).

/** A key or index as a pointer segment: `~` as `~0`, `/` as `~1`. */
export const escapePointer = (segment: string | number): string =>
  String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
