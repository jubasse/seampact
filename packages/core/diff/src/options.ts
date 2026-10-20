import { isIrCalendarDate } from "@seampact/spec/ir";
import {
  DEFAULT_DIFF_EXEMPTIONS,
  DEFAULT_DIFF_GATE,
  DIFF_EXEMPTIONS,
  DIFF_GATE_SCOPES,
  type DiffExemption,
  type DiffGateScope,
} from "@seampact/spec/config";

export type { DiffExemption, DiffGateScope };

export interface DiffOptions {
  /** Today as a calendar date (`YYYY-MM-DD`): the diff's only time input. */
  readonly today: string;
  /** Which broken sides fail `additive-only`; `clients` when absent (the app config's `diff.gate`). */
  readonly gate?: DiffGateScope;
  /** The breaking changes reported but not gated; both exemptions when absent (the app config's `diff.exempt`). */
  readonly exempt?: readonly DiffExemption[];
}

export interface ResolvedDiffOptions {
  readonly today: string;
  readonly gate: DiffGateScope;
  readonly exempt: readonly DiffExemption[];
}

// The options with their defaults; a value outside its known set is a caller error, thrown with its fix.
export function resolveDiffOptions(options: DiffOptions): ResolvedDiffOptions {
  if (!isIrCalendarDate(options.today)) {
    throw new Error(
      `diff options: today is ${JSON.stringify(options.today)}, not a calendar date. Fix: pass today as YYYY-MM-DD.`,
    );
  }

  const gate = options.gate ?? DEFAULT_DIFF_GATE;

  if (!DIFF_GATE_SCOPES.includes(gate)) {
    throw new Error(
      `diff options: gate is ${JSON.stringify(gate)}. Fix: pass one of ${DIFF_GATE_SCOPES.join(", ")}.`,
    );
  }

  const exempt = [...new Set(options.exempt ?? DEFAULT_DIFF_EXEMPTIONS)].sort();
  const unknownExemption = exempt.find((exemption) => !DIFF_EXEMPTIONS.includes(exemption));

  if (unknownExemption !== undefined) {
    throw new Error(
      `diff options: exempt holds ${JSON.stringify(unknownExemption)}. Fix: keep only ${DIFF_EXEMPTIONS.join(", ")}.`,
    );
  }

  return { today: options.today, gate, exempt };
}
