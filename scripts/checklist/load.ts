import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { Ids, Item, Model, Problem, Proof, TestRef } from "./model.ts";
import { CHECKLIST_FILE, IDS_FILE, PROOFS_DIR } from "./model.ts";
import { isKnownTarget } from "./targets.ts";

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(isStr);

const CHK_ID = /^CHK-\d{3,}$/;
const FR_ID = /^FR-\d+$/;
const SCN_ID = /^SCN-\d{3,}$/;
const TEST_REF = /^([a-z][a-z0-9-]*): ([^#\s][^#]*)#(\S.*)$/;

function readYaml(root: string, file: string, problems: Problem[]): unknown {
  const abs = join(root, file);

  if (!existsSync(abs)) {
    problems.push({ file, message: "file does not exist" });

    return undefined;
  }

  try {
    return parse(readFileSync(abs, "utf8"));
  } catch (e) {
    problems.push({ file, message: `not valid YAML: ${(e as Error).message.split("\n")[0]}` });

    return undefined;
  }
}

function unknownKeys(r: Rec, allowed: readonly string[]): string[] {
  return Object.keys(r).filter((k) => !allowed.includes(k));
}

/** A path inside the repository: relative, no `..`, no backslash. */
export function isRepoRelative(p: string): boolean {
  return !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes("..");
}

export function loadIds(root: string, problems: Problem[]): Ids {
  const out: Ids = { frs: {}, scenarios: {} };
  const raw = readYaml(root, IDS_FILE, problems);

  if (raw === undefined) return out;

  if (!isRec(raw)) {
    problems.push({ file: IDS_FILE, message: "must be a mapping with `frs` and `scenarios`" });

    return out;
  }

  for (const extra of unknownKeys(raw, ["frs", "scenarios"]))
    problems.push({ file: IDS_FILE, message: `unknown key \`${extra}\`` });

  for (const [key, pattern, into] of [
    ["frs", FR_ID, out.frs],
    ["scenarios", SCN_ID, out.scenarios],
  ] as const) {
    const section = raw[key];

    if (!isRec(section)) {
      problems.push({ file: IDS_FILE, message: `\`${key}\` must be a mapping of id to text` });
      continue;
    }

    for (const [id, text] of Object.entries(section)) {
      if (!pattern.test(id) || !isStr(text))
        problems.push({ file: IDS_FILE, id, message: `malformed entry under \`${key}\`` });
      else into[id] = text;
    }
  }

  return out;
}

export function loadItems(
  root: string,
  ids: Ids,
  problems: Problem[],
  dropped: Set<string> = new Set(),
): Item[] {
  const items: Item[] = [];
  const raw = readYaml(root, CHECKLIST_FILE, problems);

  if (raw === undefined) return items;
  const file = CHECKLIST_FILE;

  if (!isRec(raw) || raw.schema !== 1 || !Array.isArray(raw.items)) {
    problems.push({ file, message: "must be a mapping with `schema: 1` and an `items` list" });

    return items;
  }

  for (const extra of unknownKeys(raw, ["schema", "items", "not_in_checklist"]))
    problems.push({ file, message: `unknown top-level key \`${extra}\`` });
  const skipped = raw.not_in_checklist;

  if (
    skipped !== undefined &&
    !(
      Array.isArray(skipped) && skipped.every((s) => isRec(s) && isStr(s.source) && isStr(s.reason))
    )
  )
    problems.push({
      file,
      message: "`not_in_checklist` must be a list of { source, reason } entries",
    });

  const seen = new Set<string>();
  let previous = 0;

  for (const [index, entry] of raw.items.entries()) {
    const where = isRec(entry) && isStr(entry.id) ? entry.id : `item #${index + 1}`;
    const bad = (message: string) => problems.push({ file, id: where, message });

    if (!isRec(entry)) {
      bad("malformed item: not a mapping");
      continue;
    }

    if (!isStr(entry.id) || !CHK_ID.test(entry.id)) {
      bad("malformed item: `id` must look like CHK-123");
      continue;
    }

    const id = entry.id;
    const before = problems.length;

    for (const extra of unknownKeys(entry, [
      "id",
      "fact",
      "frs",
      "scenario",
      "targets",
      "source",
      "retired",
    ])) {
      bad(
        extra === "fixture" || extra === "tests"
          ? `\`${extra}\` belongs in docs/conformance/proofs/<lane-id>.yaml, never in the checklist`
          : `malformed item: unknown key \`${extra}\``,
      );
    }

    if (!isStr(entry.fact)) bad("malformed item: `fact` must be a non-empty string");

    if (entry.source !== undefined && !isStr(entry.source))
      bad("malformed item: `source` must be a non-empty string");

    if (entry.retired !== undefined && !isStr(entry.retired))
      bad("malformed item: `retired` must name the reason");

    if (!isStrList(entry.frs)) bad("malformed item: `frs` must be a non-empty list");
    else
      for (const fr of entry.frs)
        if (!Object.hasOwn(ids.frs, fr)) bad(`unknown FR id ${fr} (not in ${IDS_FILE})`);

    if (!isStr(entry.scenario)) bad("malformed item: `scenario` must be a scenario id");
    else if (!Object.hasOwn(ids.scenarios, entry.scenario))
      bad(`unknown scenario id ${entry.scenario} (not in ${IDS_FILE})`);

    if (!isStrList(entry.targets)) bad("malformed item: `targets` must be a non-empty list");
    else for (const t of entry.targets) if (!isKnownTarget(t)) bad(`unknown target "${t}"`);

    const n = Number(id.slice(4));

    if (seen.has(id)) bad("duplicate id");
    else if (n < previous)
      bad(`id out of order (follows CHK-${String(previous).padStart(3, "0")})`);
    seen.add(id);
    previous = Math.max(previous, n);

    if (problems.length !== before) dropped.add(id);
    else
      items.push({
        id,
        fact: entry.fact as string,
        frs: entry.frs as string[],
        scenario: entry.scenario as string,
        targets: entry.targets as string[],
        ...(entry.source === undefined ? {} : { source: entry.source as string }),
        ...(entry.retired === undefined ? {} : { retired: entry.retired as string }),
      });
  }

  return items;
}

export function loadProofs(root: string, problems: Problem[]): Proof[] {
  const out: Proof[] = [];
  const dir = join(root, PROOFS_DIR);

  if (!existsSync(dir)) return out;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();

  for (const name of files) {
    const file = `${PROOFS_DIR}/${name}`;
    const raw = readYaml(root, file, problems);

    if (raw === undefined) continue;
    const bad = (message: string, id?: string) =>
      problems.push(id === undefined ? { file, message } : { file, id, message });

    if (!isRec(raw) || !isStr(raw.lane) || !Array.isArray(raw.proofs)) {
      bad("malformed proof file: needs `lane` and a `proofs` list");
      continue;
    }

    for (const extra of unknownKeys(raw, ["lane", "proofs"])) bad(`unknown key \`${extra}\``);
    const lane = raw.lane;

    if (`${lane}.yaml` !== name && `${lane}.yml` !== name)
      bad(`lane "${lane}" does not match the file name`);
    const seen = new Set<string>();

    for (const [index, entry] of raw.proofs.entries()) {
      if (!isRec(entry) || !isStr(entry.id) || !CHK_ID.test(entry.id)) {
        bad(`malformed proof #${index + 1}: \`id\` must look like CHK-123`);
        continue;
      }

      const id = entry.id;
      const before = problems.length;

      for (const extra of unknownKeys(entry, ["id", "fixtures", "tests"]))
        bad(`malformed proof: unknown key \`${extra}\``, id);

      if (seen.has(id)) bad("duplicate proof entry for this id in the file", id);
      seen.add(id);
      const fixtures = entry.fixtures ?? [];
      const tests = entry.tests ?? [];

      if (!Array.isArray(fixtures) || !fixtures.every(isStr))
        bad("malformed proof: `fixtures` must be a list of paths", id);
      else
        for (const f of fixtures)
          if (!isRepoRelative(f)) bad(`fixture path "${f}" must be repository-relative`, id);
      const refs: TestRef[] = [];

      if (!Array.isArray(tests) || !tests.every(isStr))
        bad("malformed proof: `tests` must be a list of '<target>: <path>#<test name>'", id);
      else
        for (const t of tests) {
          const m = TEST_REF.exec(t);

          if (!m) bad(`malformed test "${t}": expected '<target>: <path>#<test name>'`, id);
          else if (!isRepoRelative(m[2] as string))
            bad(`test path "${m[2]}" must be repository-relative`, id);
          else
            refs.push({
              raw: t,
              target: m[1] as string,
              path: m[2] as string,
              name: m[3] as string,
            });
        }

      if (
        (Array.isArray(fixtures) ? fixtures.length : 0) +
          (Array.isArray(tests) ? tests.length : 0) ===
          0 &&
        problems.length === before
      )
        bad("empty proof: lists neither a fixture nor a test", id);

      if (problems.length === before)
        out.push({ file, lane, id, fixtures: fixtures as string[], tests: refs });
    }
  }

  return out;
}

export function loadModel(root: string, problems: Problem[]): Model {
  const ids = loadIds(root, problems);
  const dropped = new Set<string>();
  const items = loadItems(root, ids, problems, dropped);
  const proofs = loadProofs(root, problems);

  return { items, proofs, ids, dropped };
}
