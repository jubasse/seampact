import type { CheckLevel } from "@seampact/spec/config";

// What `checks.openapi` and `checks.generated` are when the config leaves them out (ADR 0011, ADR 0015).
export const DEFAULT_DRIFT_CHECK_LEVEL: CheckLevel = "error";

const LEVEL_STRICTNESS: Readonly<Record<CheckLevel, number>> = {
  disabled: 0,
  warning: 1,
  error: 2,
};

// The strictest of several levels; `disabled` when there is none.
export function strictestLevel(levels: readonly CheckLevel[]): CheckLevel {
  return levels.reduce<CheckLevel>(
    (strictest, level) =>
      LEVEL_STRICTNESS[level] > LEVEL_STRICTNESS[strictest] ? level : strictest,
    "disabled",
  );
}
