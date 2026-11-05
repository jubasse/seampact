// The consumers that run a server target in another framework major or module format, and report under their own
// id. This file imports nothing, so the checklist script reads the same table.

/** Each report target variant, and the server target it runs: the one table every reader of a report uses. */
export const TARGET_VARIANTS: ReadonlyMap<string, string> = new Map([
  ["nestjs-cjs", "nestjs"],
  ["adonis6", "adonis"],
  ["express4", "express"],
]);

/** The server target a report target names: a variant mapped to its target, any other name unchanged. */
export function baseTargetOf(reportTarget: string): string {
  return TARGET_VARIANTS.get(reportTarget) ?? reportTarget;
}
