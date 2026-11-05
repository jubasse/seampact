import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { loadModel } from "./load.ts";
import type { Item, Model, Problem, Proof } from "./model.ts";
import { CHECKLIST_FILE, chkNumber } from "./model.ts";
import type { ItemAfter1_0 } from "./release-scope.ts";
import { releaseGateTargets, releaseScopeProblems } from "./release-scope.ts";
import type { SuiteProof } from "./suite-reports.ts";
import { loadSuiteReports } from "./suite-reports.ts";
import { expandTargets } from "./targets.ts";
import type { VariantRowSet } from "./variant-rows.ts";
import { missingVariantRows, passedWithoutFailure, variantRowSetProblems } from "./variant-rows.ts";

export interface CheckOptions {
  /** Repository root (the directory holding docs/conformance). */
  root: string;
  /** Git ref to compare ids against: no id removed instead of retired, no renumbering. */
  base?: string;
  /** Directory holding the test-seampact-<name> projects, to check consumer test paths. */
  consumers?: string;
  /** From the 1.0 release gate on: every live id needs a fixture and a test per target. */
  releaseGate?: boolean;
  /** With the release gate: a directory of downloaded http-suite reports, each a proof for its target. */
  suiteReports?: string;
  /** The items the 1.0 gate does not require (release-scope.ts); none when absent, as for a fixture checklist. */
  itemsAfter1_0?: ReadonlyMap<string, ItemAfter1_0>;
  /** The items a target proves across several CI rows (variant-rows.ts); none when absent. */
  variantRowSets?: ReadonlyMap<string, VariantRowSet>;
}

export const CONSUMER_PREFIX = "test-seampact-";

/** Proofs merged per checklist id, in file order. */
export function proofsById(proofs: readonly Proof[]): Map<string, Proof[]> {
  const out = new Map<string, Proof[]>();

  for (const p of proofs) out.set(p.id, [...(out.get(p.id) ?? []), p]);

  return out;
}

export function checkModel(
  model: Model,
  o: CheckOptions,
  suiteProofs: readonly SuiteProof[] = [],
): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map<string, Item>(model.items.map((i) => [i.id, i]));

  for (const p of model.proofs) {
    const item = byId.get(p.id);
    const at = (message: string) => problems.push({ file: p.file, id: p.id, message });

    if (!item) {
      // An item dropped by a load problem is already reported; do not cascade onto its proofs.
      if (!model.dropped.has(p.id)) at("proof for an unknown id (not in the checklist)");
      continue;
    }

    if (item.retired !== undefined) at(`proof for a retired id (retired: ${item.retired})`);

    for (const f of p.fixtures)
      if (!existsSync(join(o.root, f))) at(`fixture path does not exist: ${f}`);
    const listed = expandTargets(item.targets);

    for (const t of p.tests) {
      if (!listed.includes(t.target))
        at(
          `test for a target the item does not list: ${t.target} (item lists ${item.targets.join(", ")})`,
        );

      if (t.path.startsWith(CONSUMER_PREFIX)) {
        if (o.consumers !== undefined && !existsSync(join(o.consumers, t.path)))
          at(`test-consumer test file does not exist: ${t.path} (under ${o.consumers})`);
      } else if (!existsSync(join(o.root, t.path))) at(`test file does not exist: ${t.path}`);
    }
  }

  if (o.base !== undefined) problems.push(...checkAgainstBase(model, o.root, o.base));

  const scope: GateScope = {
    itemsAfter1_0: o.itemsAfter1_0 ?? new Map(),
    variantRowSets: o.variantRowSets ?? new Map(),
    proofs: proofsById(model.proofs),
    suitePairs: o.releaseGate ? suitePairsOf(model, suiteProofs, problems) : new Map(),
  };

  problems.push(...variantRowSetProblems(model.items, scope.variantRowSets));
  problems.push(
    ...releaseScopeProblems(
      model.items,
      scope.itemsAfter1_0,
      (id, target) => testedByProof(scope, id, target) || suitePassed(scope, id, target),
    ),
  );

  if (o.releaseGate) problems.push(...releaseGateProblems(model, scope));

  return problems;
}

/** What the release gate reads besides the items: the policy tables, the proofs and the suite proofs per pair. */
interface GateScope {
  itemsAfter1_0: ReadonlyMap<string, ItemAfter1_0>;
  variantRowSets: ReadonlyMap<string, VariantRowSet>;
  proofs: ReadonlyMap<string, readonly Proof[]>;
  suitePairs: ReadonlyMap<string, readonly SuiteProof[]>;
}

/**
 * The suite proofs per pair of id and target. A suite report that failed the id, or that proves an id the checklist
 * does not hold live for its target, is a problem.
 */
function suitePairsOf(
  model: Model,
  suiteProofs: readonly SuiteProof[],
  problems: Problem[],
): Map<string, SuiteProof[]> {
  const byId = new Map<string, Item>(model.items.map((i) => [i.id, i]));
  const suitePairs = new Map<string, SuiteProof[]>();

  for (const s of suiteProofs) {
    const item = byId.get(s.id);
    const at = (message: string) => problems.push({ file: s.file, id: s.id, message });

    if (!item) {
      if (!model.dropped.has(s.id)) at("suite report proves an unknown id (not in the checklist)");
      continue;
    }

    if (item.retired !== undefined) {
      at(`suite report proves a retired id (retired: ${item.retired})`);
      continue;
    }

    if (!expandTargets(item.targets).includes(s.target)) {
      at(
        `suite report of a target the item does not list: ${s.target} (item lists ${item.targets.join(", ")})`,
      );
      continue;
    }

    if (s.outcome === "failed") {
      at(`release gate: failed for target ${s.target} in this suite report`);
    }

    const key = suiteKey(s.id, s.target);

    suitePairs.set(key, [...(suitePairs.get(key) ?? []), s]);
  }

  return suitePairs;
}

function testedByProof(scope: GateScope, id: string, target: string): boolean {
  return (scope.proofs.get(id) ?? []).some((p) => p.tests.some((t) => t.target === target));
}

/** A pair passes its suite runs when one passed it and none failed it; a variant row set needs that of every row. */
function suitePassed(scope: GateScope, id: string, target: string): boolean {
  const pairProofs = scope.suitePairs.get(suiteKey(id, target)) ?? [];
  const rowSet = scope.variantRowSets.get(id);

  if (rowSet?.target === target) return missingVariantRows(rowSet, pairProofs).length === 0;

  return passedWithoutFailure(pairProofs);
}

/**
 * Every live id needs a fixture and, for every target the gate requires of it, a test. A proof file's fixture or test
 * counts, and so does a suite report that passed the id: its cases are the committed fixture and its run the
 * target's test. An id whose every pair comes after 1.0 needs neither.
 */
function releaseGateProblems(model: Model, scope: GateScope): Problem[] {
  const problems: Problem[] = [];

  for (const item of model.items) {
    if (item.retired !== undefined) continue;
    const targets = releaseGateTargets(item, scope.itemsAfter1_0);
    const at = (message: string) => problems.push({ file: CHECKLIST_FILE, id: item.id, message });

    if (targets.length === 0) continue;

    const mine = scope.proofs.get(item.id) ?? [];

    if (
      !mine.some((p) => p.fixtures.length > 0) &&
      !targets.some((t) => suitePassed(scope, item.id, t))
    )
      at("release gate: no fixture");

    for (const target of targets) {
      const pairProofs = scope.suitePairs.get(suiteKey(item.id, target)) ?? [];

      // A failed suite run is already reported with its report.
      if (pairProofs.some((s) => s.outcome === "failed")) continue;

      if (testedByProof(scope, item.id, target) || suitePassed(scope, item.id, target)) continue;

      at(`release gate: no test for target ${target}${noTestReason(scope, item.id, target)}`);
    }
  }

  return problems;
}

function noTestReason(scope: GateScope, id: string, target: string): string {
  const pairProofs = scope.suitePairs.get(suiteKey(id, target)) ?? [];
  const rowSet = scope.variantRowSets.get(id);

  if (rowSet?.target === target && pairProofs.some((s) => s.outcome === "passed"))
    return ` (no passed suite report from the variant rows: ${missingVariantRows(rowSet, pairProofs).join(", ")})`;

  return pairProofs.some((s) => s.outcome === "refused") ? " (its suite run refused the id)" : "";
}

function suiteKey(id: string, target: string): string {
  return `${id} ${target}`;
}

function gitShow(root: string, ref: string, file: string): string | undefined {
  const run = (args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  try {
    run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new Error(`--base ${ref}: not a git ref this checkout can resolve (fetch more history?)`);
  }

  if (run(["ls-tree", "--name-only", ref, "--", file]).trim() === "") return undefined;

  return run(["show", `${ref}:${file}`]);
}

function checkAgainstBase(model: Model, root: string, base: string): Problem[] {
  const text = gitShow(root, base, CHECKLIST_FILE);

  if (text === undefined) return [];
  const problems: Problem[] = [];
  let baseItems: { id: string; retired: boolean }[] = [];

  try {
    const doc = parse(text) as { items?: { id?: unknown; retired?: unknown }[] };

    baseItems = (doc.items ?? [])
      .filter((i) => typeof i.id === "string" && /^CHK-\d+$/.test(i.id))
      .map((i) => ({ id: i.id as string, retired: i.retired !== undefined }));
  } catch {
    return [{ file: CHECKLIST_FILE, message: `the checklist at ${base} is not valid YAML` }];
  }

  const head = new Map(model.items.map((i) => [i.id, i]));

  for (const b of baseItems) {
    const now = head.get(b.id);

    if (!now)
      problems.push({
        file: CHECKLIST_FILE,
        id: b.id,
        message: `removed instead of retired (present at ${base}; keep it with \`retired: <reason>\`)`,
      });
    else if (b.retired && now.retired === undefined)
      problems.push({
        file: CHECKLIST_FILE,
        id: b.id,
        message: `retired at base but live again (an id stays retired once retired at ${base})`,
      });
  }

  const baseIds = new Set(baseItems.map((b) => b.id));
  const highest = Math.max(0, ...baseItems.map((b) => chkNumber(b.id)));

  for (const item of model.items)
    if (!baseIds.has(item.id) && chkNumber(item.id) <= highest)
      problems.push({
        file: CHECKLIST_FILE,
        id: item.id,
        message: `new id not above the highest id at ${base} (CHK-${String(highest).padStart(3, "0")}): renumbering`,
      });

  return problems;
}

export function check(o: CheckOptions): Problem[] {
  const problems: Problem[] = [];
  const model = loadModel(o.root, problems);
  const suiteProofs =
    o.suiteReports === undefined ? [] : loadSuiteReports(o.suiteReports, problems);

  problems.push(...checkModel(model, o, suiteProofs));

  return problems;
}
