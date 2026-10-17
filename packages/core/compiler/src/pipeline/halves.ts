// A leaf module: it imports nothing, so `derivations/table.ts` (its owner columns) and `pipeline/` both import
// it without a cycle.
//
// The six halves of the three passes of ADR 0006, in run order. Each half is a step of the stop rule (ADR 0006
// section 1): a half that reports an error completes, and no later half of that api runs. The order puts each
// half after every half it reads: `tree.nodes` needs the type uses of `tree.schemas` (its `TreeSchemaService`),
// `access.rights` reads the access `access.identity` resolved, `derive.wire` reads both access halves, and
// `derive.errors` reads what `derive.wire` wrote (idempotency, cache, concurrency, paging parameters) instead of
// re-computing the triggers.
export const pipelineHalves = [
  "tree.schemas",
  "tree.nodes",
  "access.identity",
  "access.rights",
  "derive.wire",
  "derive.errors",
] as const;

export type HalfName = (typeof pipelineHalves)[number];

/** The pass a half belongs to (ADR 0006 section 2). */
export type PassName = "tree" | "access" | "derive";

/** The pass of a half: `PassOf<"tree.nodes">` is `"tree"`. */
export type PassOf<H extends HalfName> = H extends `${infer P extends PassName}.${string}`
  ? P
  : never;

/** The pass of a half, at run time. */
export function pipelinePassOf(half: HalfName): PassName {
  const pass = half.slice(0, half.indexOf("."));

  if (pass === "tree" || pass === "access" || pass === "derive") return pass;

  throw new Error(`half ${half} names no pass`);
}
