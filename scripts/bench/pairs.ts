import { existsSync } from "node:fs";
import { join } from "node:path";
import { offeredValidatorPairs } from "@seampact/spec/compatibility";

// One measured pair: the consumer overlay that runs a target on one framework major, with one validator library.
export interface BenchPair {
  readonly id: string;
  readonly overlay: string;
  readonly baselineFramework: string;
  readonly validators: string;
  /** The generated server checks outgoing bodies against the declared response (the consumer config's setting). */
  readonly bodyValidation: boolean;
}

const TARGET_PACKAGE_PREFIX = "@seampact/codegen-";

// The pairs of the compatibility matrix, in matrix order, each on the consumer overlay the matrix records for its
// framework major (`express`, `express4`).
export function benchPairs(consumersRoot: string): readonly BenchPair[] {
  return offeredValidatorPairs().map((pair) => {
    const targetId = pair.target.slice(TARGET_PACKAGE_PREFIX.length);
    const overlay = pair.consumer;

    if (!existsSync(join(consumersRoot, "targets", overlay))) {
      throw new Error(
        `bench: the matrix offers ${pair.target} on ${pair.framework} ${pair.frameworkMajor}, but scripts/consumers/targets has no '${overlay}' overlay.`,
      );
    }

    return {
      id: `${overlay}-${pair.validator}`,
      overlay,
      baselineFramework: targetId,
      validators: pair.validator,
      bodyValidation: true,
    };
  });
}

// The pairs a run measures: all of them, or the one `--target` and `--validators` name.
export function selectPairs(
  all: readonly BenchPair[],
  selection: { readonly target?: string; readonly validators?: string; readonly all: boolean },
): readonly BenchPair[] {
  if (selection.all) return all;

  const chosen = all.filter(
    (pair) => pair.overlay === selection.target && pair.validators === selection.validators,
  );

  if (chosen.length === 0) {
    const known = all.map((pair) => `${pair.overlay}+${pair.validators}`).join(", ");

    throw new Error(
      `bench: no pair '${selection.target}' with '${selection.validators}'; the matrix offers ${known}.`,
    );
  }

  return chosen;
}

const BODY_VALIDATION_OFF_SUFFIX = "-body-off";

// The same pair with the generated server's outgoing body check switched off, measured as a second row.
export function withoutBodyValidation(pair: BenchPair): BenchPair {
  return { ...pair, id: `${pair.id}${BODY_VALIDATION_OFF_SUFFIX}`, bodyValidation: false };
}
