import type { ContractIR } from "@seampact/spec/ir";
import { deprecationReport } from "./deprecation/deprecation.js";
import { applyGate, appliedPolicy } from "./gate/gate.js";
import { type DiffOptions, resolveDiffOptions } from "./options.js";
import type { DiffResult, DiffSide } from "./result.js";
import { compareText } from "./walk/json.js";
import { wholeDiffRefusals } from "./walk/refusals.js";
import { walkContracts } from "./walk/walk.js";

// The diff of two IRs of one api (FR-13): pure over its inputs, so every runner gets the same report from the
// same IRs. The caller passes IRs that passed `createIrValidator` and `checkIrSupport`.

/** Lists, classifies and gates the changes from `before` to `after`, and reports the deprecations. */
export function diffContracts(
  before: ContractIR,
  after: ContractIR,
  options: DiffOptions,
): DiffResult {
  const resolved = resolveDiffOptions(options);
  const refusals = wholeDiffRefusals(before, after);

  if (refusals.length > 0) return { ok: false, refusals };

  const walk = walkContracts(before, after);

  if (walk.refusals.length > 0) return { ok: false, refusals: [...walk.refusals] };

  const failures = applyGate(walk.changes, before, after, resolved);

  return {
    ok: true,
    api: after.api.id,
    before: sideOf(before),
    after: sideOf(after),
    policy: {
      before: before.api.compat.policy,
      after: after.api.compat.policy,
      applied: appliedPolicy(before.api.compat.policy, after.api.compat.policy),
    },
    settings: { gate: resolved.gate, exempt: [...resolved.exempt] },
    changes: walk.changes,
    gate: { passed: failures.length === 0, failures },
    deprecations: deprecationReport(before, after, resolved.today),
  };
}

/**
 * Diffs each api of two sets keyed by api name (the shape `fetchBundle` returns), sorted by name. An api only in
 * `before` is diffed against itself with no operations, so every operation is removed; one only in `after` is
 * diffed from itself with no operations, so every operation is added.
 */
export function diffContractSets(
  before: ReadonlyMap<string, ContractIR>,
  after: ReadonlyMap<string, ContractIR>,
  options: DiffOptions,
): Map<string, DiffResult> {
  const names = [...new Set([...before.keys(), ...after.keys()])].sort(compareText);
  const results = new Map<string, DiffResult>();

  for (const name of names) {
    const beforeIr = before.get(name);
    const afterIr = after.get(name);
    const baseline = beforeIr ?? withoutOperations(afterIr);
    const next = afterIr ?? withoutOperations(beforeIr);

    if (baseline !== undefined && next !== undefined)
      results.set(name, diffContracts(baseline, next, options));
  }

  return results;
}

function withoutOperations(ir: ContractIR | undefined): ContractIR | undefined {
  return ir === undefined ? undefined : { ...ir, operations: [] };
}

function sideOf(ir: ContractIR): DiffSide {
  return {
    version: structuredClone(ir.api.version),
    irRevision: ir.irRevision,
    packs: ir.packs.map((pack) => ({ name: pack.name, version: pack.version })),
  };
}
