import type { CompatPolicy, ContractIR, Operation } from "@seampact/spec/ir";
import { DIFF_CODES } from "../diff-codes.js";
import type { DiffExemption, ResolvedDiffOptions } from "../options.js";
import type { DiffBreak, DiffChange, GateFailure } from "../result.js";

// The release gate (FR-13, SCN-019, SCN-050): under `additive-only` every change breaking a gated side fails,
// unless an exemption covers it; each failing change on a stable operation is refused once more as
// `diff.maturity.stable`. Under `none` the changes are reported and the gate passes.

const ADDITIVE_ONLY: CompatPolicy = "additive-only";
const NO_POLICY: CompatPolicy = "none";
const STABLE = "stable";
const EXPERIMENTAL = "experimental";

/** The stricter of the two policies: relaxing and breaking in one release would escape the gate. */
export function appliedPolicy(before: CompatPolicy, after: CompatPolicy): CompatPolicy {
  return before === ADDITIVE_ONLY || after === ADDITIVE_ONLY ? ADDITIVE_ONLY : NO_POLICY;
}

/** The gate failures; each exempted change gets its exemption named. */
export function applyGate(
  changes: readonly DiffChange[],
  before: ContractIR,
  after: ContractIR,
  options: ResolvedDiffOptions,
): GateFailure[] {
  if (appliedPolicy(before.api.compat.policy, after.api.compat.policy) !== ADDITIVE_ONLY) return [];

  const failures: GateFailure[] = [];

  for (const change of changes) {
    const gatedBreaks = change.breaks.filter(
      (side) => options.gate === "both" || side === "clients",
    );

    if (gatedBreaks.length === 0) continue;

    const exemption = exemptionOf(change, before, options);

    if (exemption !== undefined) {
      change.exemption = exemption;
      continue;
    }

    failures.push(policyFailure(change));
    failures.push(...stableFailures(change, before, after));
  }

  return failures;
}

function exemptionOf(
  change: DiffChange,
  before: ContractIR,
  options: ResolvedDiffOptions,
): DiffExemption | undefined {
  if (
    options.exempt.includes("sunsetPassed") &&
    isRemovalPastSunset(change, before, options.today)
  ) {
    return "sunsetPassed";
  }

  if (options.exempt.includes("experimental") && isOnExperimental(change, before))
    return "experimental";

  return undefined;
}

function isRemovalPastSunset(change: DiffChange, before: ContractIR, today: string): boolean {
  if (change.kind !== "operation.removed") return false;

  const sunset = beforeOperation(before, change.operations[0])?.deprecated?.sunset;

  return sunset !== undefined && sunset <= today;
}

// Every operation of the change is experimental in the baseline; an api-wide change reads the api's level.
function isOnExperimental(change: DiffChange, before: ContractIR): boolean {
  if (change.operations.length === 0) return before.api.maturity === EXPERIMENTAL;

  return change.operations.every(
    (id) => beforeOperation(before, id)?.maturity.level === EXPERIMENTAL,
  );
}

function beforeOperation(before: ContractIR, id: string | undefined): Operation | undefined {
  return before.operations.find((operation) => operation.id === id);
}

function policyFailure(change: DiffChange): GateFailure {
  const on = change.operations.length > 0 ? ` on ${change.operations.join(", ")}` : "";

  return {
    ...failureBase(change),
    code: DIFF_CODES.policyBreaking,
    message: `${changeText(change)} breaks ${breaksText(change.breaks)}${on}, and compat.policy is additive-only.`,
    fix: "Make the change additive (keep the old member beside the new one), or publish it as a new api version; a release that breaks on purpose sets compat: { policy: none } in both versions.",
  };
}

function stableFailures(change: DiffChange, before: ContractIR, after: ContractIR): GateFailure[] {
  if (change.operations.length === 0) {
    if (before.api.maturity !== STABLE && after.api.maturity !== STABLE) return [];

    return [stableFailure(change, undefined, "api")];
  }

  return change.operations.flatMap((id) => {
    const maturity = [
      beforeOperation(before, id)?.maturity,
      beforeOperation(after, id)?.maturity,
    ].find((candidate) => candidate?.level === STABLE);

    return maturity === undefined ? [] : [stableFailure(change, id, maturity.source)];
  });
}

function stableFailure(
  change: DiffChange,
  operation: string | undefined,
  source: string,
): GateFailure {
  const subject = operation === undefined ? "The api" : operation;

  return {
    ...failureBase(change),
    code: DIFF_CODES.maturityStable,
    message: `${subject} is stable (from ${source}) and ${changeText(change)} breaks ${breaksText(change.breaks)}.`,
    fix: "A stable operation takes additive changes only: revert the change, or add a successor operation and deprecate this one.",
    maturity: { ...(operation === undefined ? {} : { operation }), level: STABLE, source },
  };
}

function failureBase(change: DiffChange): Omit<GateFailure, "code" | "message" | "fix"> {
  return {
    kind: change.kind,
    case: change.case,
    pointer: change.pointer,
    position: change.position,
    breaks: [...change.breaks],
    operations: [...change.operations],
  };
}

function changeText(change: DiffChange): string {
  return `${change.kind} (${change.case}) at ${change.pointer}`;
}

export function breaksText(breaks: readonly DiffBreak[]): string {
  return breaks.join(" and ");
}
