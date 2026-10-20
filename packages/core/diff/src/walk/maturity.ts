import type { Maturity } from "@seampact/spec/ir";
import { type ChangeSite, emitAt, refuseUnknownValue, type WalkContext } from "./context.js";

// Maturity levels in the order of their promise: lowering one breaks the clients that relied on it.

const MATURITY_RANKS: Readonly<Record<string, number>> = {
  experimental: 0,
  provisional: 1,
  stable: 2,
};

export function isKnownMaturity(level: Maturity): boolean {
  return Object.hasOwn(MATURITY_RANKS, level);
}

export function compareMaturityLevel(
  context: WalkContext,
  site: ChangeSite,
  pointer: string,
  before: Maturity,
  after: Maturity,
): void {
  const beforeRank = MATURITY_RANKS[before];
  const afterRank = MATURITY_RANKS[after];

  if (beforeRank === undefined || afterRank === undefined) {
    refuseUnknownValue(context, site, pointer, beforeRank === undefined ? before : after);

    return;
  }

  if (beforeRank === afterRank) return;

  emitAt(context, site, {
    kind: "maturity",
    case: afterRank < beforeRank ? "lowered" : "raised",
    pointer,
    before,
    after,
  });
}
