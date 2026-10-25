// A request sends at most one of the `after` and `before` cursors; both answer 400 (ADR 0002 section 14). Copied
// into the generated tree as is.

interface CursorPair {
  readonly positionParam: string;
  readonly beforeParam?: string;
}

/** The `before` query member, when the request sends it beside the `after` one; else undefined. */
export function repeatedBeforeParam(
  paging: CursorPair | undefined,
  query: Readonly<Record<string, unknown>>,
): string | undefined {
  if (paging?.beforeParam === undefined) return undefined;

  if (query[paging.positionParam] === undefined || query[paging.beforeParam] === undefined) {
    return undefined;
  }

  return paging.beforeParam;
}
