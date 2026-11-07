// A request sends at most one of the `after` and `before` cursors; both answer 400 (ADR 0002 section 14).

// The two members of the route's paging entry this check reads; `contract-route.ts` is not imported, so the
// helper's test type-checks inside codegen-core without the generated tree's packages.
interface CursorPair {
  readonly positionParam: string;
  readonly beforeParam?: string;
}

/** The `before` query member, when the request sends it beside the `after` one; else undefined. */
export function beforeParamSentWithAfter(
  paging: CursorPair | undefined,
  query: Readonly<Record<string, unknown>>,
): string | undefined {
  if (paging?.beforeParam === undefined) return undefined;

  if (query[paging.positionParam] === undefined || query[paging.beforeParam] === undefined) {
    return undefined;
  }

  return paging.beforeParam;
}
