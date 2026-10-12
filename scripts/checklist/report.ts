import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONSUMER_PREFIX, proofsById } from "./check.ts";
import type { Model, Proof, TestRef } from "./model.ts";
import { expandTargets } from "./targets.ts";

interface VitestJson {
  testResults: {
    name: string;
    assertionResults: { title: string; fullName?: string; status: string }[];
  }[];
}

/** Passing tests of a Vitest JSON reporter file, as (absolute file, names) pairs. */
export function loadResults(file: string): VitestJson {
  return parseResults(readFileSync(file, "utf8"), file);
}

export function parseResults(text: string, file = "results"): VitestJson {
  const raw = JSON.parse(text) as VitestJson;
  if (!raw || !Array.isArray(raw.testResults))
    throw new Error(`${file}: not Vitest JSON reporter output (no testResults)`);
  return raw;
}

/**
 * A test passed when the results hold at least one assertion of that exact file (the absolute
 * path of the repo-relative `t.path` under `root`) and name, and none of those assertions failed.
 */
export function testPassed(t: TestRef, root: string, results: VitestJson): boolean {
  const file = resolve(root, t.path);
  const matching = results.testResults
    .filter((f) => f.name === file)
    .flatMap((f) => f.assertionResults)
    .filter((a) => a.title === t.name || a.fullName === t.name);
  return matching.length > 0 && matching.every((a) => a.status === "passed");
}

export interface Share {
  target: string;
  items: number;
  fixtures: number;
  tests: number;
}

/**
 * Per target: live ids, ids with a fixture (SM-2) and ids with a test of that target (SM-1).
 * Without `results`, a fixture counts when it exists on disk and a test when it is listed.
 * With `results`, a test counts when it passed, and a proof entry's fixtures count only when
 * that entry names at least one monorepo test and every monorepo test it names passed.
 */
export function shares(model: Model, root: string, results?: VitestJson): Share[] {
  const proofs = proofsById(model.proofs);
  const per = new Map<string, Share>();
  const fixtureOk = (p: Proof): boolean => {
    if (p.fixtures.length === 0 || !p.fixtures.every((f) => existsSync(join(root, f))))
      return false;
    if (!results) return true;
    const own = p.tests.filter((t) => !t.path.startsWith(CONSUMER_PREFIX));
    return own.length > 0 && own.every((t) => testPassed(t, root, results));
  };
  for (const item of model.items) {
    if (item.retired !== undefined) continue;
    const mine = proofs.get(item.id) ?? [];
    const hasFixture = mine.some(fixtureOk);
    for (const target of expandTargets(item.targets)) {
      const s = per.get(target) ?? { target, items: 0, fixtures: 0, tests: 0 };
      s.items += 1;
      if (hasFixture) s.fixtures += 1;
      if (
        mine.some((p) =>
          p.tests.some((t) => t.target === target && (!results || testPassed(t, root, results))),
        )
      )
        s.tests += 1;
      per.set(target, s);
    }
  }
  return [...per.values()].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
}

const pct = (n: number, d: number) => `${n}/${d} (${(d === 0 ? 0 : (100 * n) / d).toFixed(1)}%)`;

export function renderReport(model: Model, root: string, results?: VitestJson): string {
  const rows = shares(model, root, results);
  const lines = [
    "## Conformance checklist",
    "",
    results ? "Counting passing tests only." : "Counting listed tests and existing fixtures.",
    "",
    "| Target | Live items | With a fixture (SM-2) | With a test (SM-1) |",
    "|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.target} | ${r.items} | ${pct(r.fixtures, r.items)} | ${pct(r.tests, r.items)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
