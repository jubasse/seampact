import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { loadModel } from "./load.ts";
import type { Item, Model, Problem, Proof } from "./model.ts";
import { CHECKLIST_FILE, chkNumber } from "./model.ts";
import { expandTargets } from "./targets.ts";

export interface CheckOptions {
  /** Repository root (the directory holding docs/conformance). */
  root: string;
  /** Git ref to compare ids against: no id removed instead of retired, no renumbering. */
  base?: string;
  /** Directory holding the test-seampact-<name> projects, to check consumer test paths. */
  consumers?: string;
  /** From the 1.0 release gate on: every live id needs a fixture and a test per target. */
  releaseGate?: boolean;
}

export const CONSUMER_PREFIX = "test-seampact-";

/** Proofs merged per checklist id, in file order. */
export function proofsById(proofs: readonly Proof[]): Map<string, Proof[]> {
  const out = new Map<string, Proof[]>();

  for (const p of proofs) out.set(p.id, [...(out.get(p.id) ?? []), p]);

  return out;
}

export function checkModel(model: Model, o: CheckOptions): Problem[] {
  const problems: Problem[] = [];
  const byId = new Map<string, Item>(model.items.map((i) => [i.id, i]));
  const proofs = proofsById(model.proofs);

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

  if (o.releaseGate) {
    for (const item of model.items) {
      if (item.retired !== undefined) continue;
      const mine = proofs.get(item.id) ?? [];
      const at = (message: string) => problems.push({ file: CHECKLIST_FILE, id: item.id, message });

      if (!mine.some((p) => p.fixtures.length > 0)) at("release gate: no fixture");

      for (const target of expandTargets(item.targets))
        if (!mine.some((p) => p.tests.some((t) => t.target === target)))
          at(`release gate: no test for target ${target}`);
    }
  }

  return problems;
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

  problems.push(...checkModel(model, o));

  return problems;
}
