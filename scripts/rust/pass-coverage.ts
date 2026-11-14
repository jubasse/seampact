// The per-function coverage of the pass halves and the stages before them over the fixtures, cut into port briefs.
//
// Run from the repository root with the compiler's flags:
//   node --experimental-transform-types --no-warnings --import ./scripts/ir-models/register.ts \
//     scripts/rust/pass-coverage.ts
// It compiles every fixture the oracle compiles, takes V8 precise coverage around each half's `run` and
// around the whole compile, and writes one table per crate under `docs/maintainers/rust-design/passes/`
// (the design note `docs/maintainers/rust-design/passes.md` says how the briefs read them).

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import { SourceMap } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverFixtures, REPO_ROOT, readExcluded } from "../oracle/fixtures.ts";
import { listTypeScriptFunctionRanges } from "./trace.ts";

const COMPILER_SOURCES = join(REPO_ROOT, "packages/core/compiler/src");
const SPEC_SOURCES = join(REPO_ROOT, "packages/core/spec/src");
const OUTPUT_DIRECTORY = join(REPO_ROOT, "docs/maintainers/rust-design/passes");

/** About the TypeScript lines one brief ports, the lane size of PORTING.md. */
export const BRIEF_LINES = 1000;
/** A function reached by at least this share of a crate's pairs is in its spine. */
export const SPINE_SHARE = 0.9;

/** One table: a crate and the TypeScript functions it ports, with what its pairs are. */
export interface CrateSpec {
  crate: string;
  /** The half whose runs are the pairs, or `compile` for a stage every compile reaches (pairs are fixtures). */
  pairs: string;
  /** Files under `packages/core/compiler/src/`, or directories ending in `/`. */
  sources: readonly string[];
  /** `file#function` taken out of the sources above: ported in another crate. */
  movedOut?: readonly string[];
  /** `file#function` of files outside the sources, ported here. */
  movedIn?: readonly string[];
  /** Order the functions other halves' crates call right after the spine (a direct import, not the schema service). */
  pullCalledElsewhere?: boolean;
}

const COMPILE = "compile";

// The crate split of the design note, section 1.
export const CRATES: readonly CrateSpec[] = [
  {
    crate: "pass-tree-shared",
    pairs: "tree.schemas",
    sources: ["passes/tree/nodes/names.ts", "passes/tree/nodes/raw.ts"],
    movedIn: ["passes/tree/nodes/relays.ts#treeNodesRelayOrigin"],
  },
  { crate: "pass-tree-schemas", pairs: "tree.schemas", sources: ["passes/tree/schemas/"] },
  {
    crate: "pass-tree-nodes",
    pairs: "tree.nodes",
    sources: ["passes/tree/nodes/"],
    pullCalledElsewhere: true,
    movedOut: [
      "passes/tree/nodes/names.ts#*",
      "passes/tree/nodes/raw.ts#*",
      "passes/tree/nodes/relays.ts#treeNodesRelayOrigin",
    ],
  },
  { crate: "templates", pairs: "tree.nodes", sources: ["templates/"] },
  { crate: "pass-access-identity", pairs: "access.identity", sources: ["passes/access/identity/"] },
  {
    crate: "pass-access-rights",
    pairs: "access.rights",
    sources: ["passes/access/rights/"],
    movedOut: ["passes/access/rights/report.ts#accessRightsQuoted"],
  },
  { crate: "pass-derive-wire", pairs: "derive.wire", sources: ["passes/derive/wire/"] },
  { crate: "pass-derive-errors", pairs: "derive.errors", sources: ["passes/derive/errors/"] },
  {
    crate: "validate",
    pairs: COMPILE,
    sources: ["validate/"],
    movedOut: ["validate/diagnostics.ts#quote", "validate/diagnostics.ts#unsafe"],
  },
  { crate: "compiler-relay-order", pairs: COMPILE, sources: ["workspace/order.ts"] },
  { crate: "pass-link", pairs: COMPILE, sources: ["passes/link/"] },
];

/** A TypeScript function as the trace names it, with the file it is in (relative to the sources root). */
export interface FunctionUnit {
  id: number;
  file: string;
  name: string;
  startLine: number;
  endLine: number;
  lines: number;
}

/** One row of a crate table. */
export interface CoverageRow {
  brief: number;
  unit: FunctionUnit;
  pairs: number;
}

/** A crate's table and the share of its pairs comparable after each brief. */
export interface CrateCoverage {
  rows: CoverageRow[];
  pairCount: number;
  spineLines: number;
  comparableAfterBrief: number[];
}

/**
 * Orders a crate's functions into briefs: the spine (reached by `SPINE_SHARE` of the pairs) first, then the
 * functions that complete the most nearly complete pairs per line, then never-reached functions in file
 * order. Each brief holds about `BRIEF_LINES` lines; the spine stays whole in brief 1. `reachedElsewhere` (functions
 * another half's crate calls) come right after the spine, so the other half's pairs do not wait for them.
 */
export function cutBriefs(
  units: readonly FunctionUnit[],
  pairs: readonly Set<number>[],
  reachedElsewhere: ReadonlySet<number> = new Set(),
): CrateCoverage {
  const reachCount = units.map((unit) => pairs.filter((pair) => pair.has(unit.id)).length);
  const spine = units.filter((unit) => isSpine(reachCount[unit.id] ?? 0, pairs.length));
  const pulled = units.filter((unit) => reachedElsewhere.has(unit.id) && !spine.includes(unit));
  const order = gainOrder(units, pairs, [...spine, ...pulled]);
  const neverReached = units.filter((unit) => (reachCount[unit.id] ?? 0) === 0);
  const briefOf = new Map<number, number>();
  const spineLines = spine.reduce((sum, unit) => sum + unit.lines, 0);
  let brief = 1;
  let briefLines = spineLines;

  for (const unit of spine) briefOf.set(unit.id, brief);

  for (const unit of [...order, ...neverReached]) {
    if (briefOf.has(unit.id)) continue;

    if (briefLines > 0 && briefLines + unit.lines > BRIEF_LINES) {
      brief += 1;
      briefLines = 0;
    }

    briefOf.set(unit.id, brief);
    briefLines += unit.lines;
  }

  const rows = [...spine, ...order, ...neverReached]
    .filter((unit, index, all) => all.findIndex((other) => other.id === unit.id) === index)
    .map((unit) => ({
      brief: briefOf.get(unit.id) ?? brief,
      unit,
      pairs: reachCount[unit.id] ?? 0,
    }));

  return {
    rows,
    pairCount: pairs.length,
    spineLines,
    comparableAfterBrief: comparableCurve(pairs, briefOf, brief),
  };
}

function isSpine(reached: number, pairCount: number): boolean {
  return pairCount > 0 && reached >= SPINE_SHARE * pairCount;
}

// Greedy: the reached function whose port completes the most pairs per line, a pair weighing more the fewer
// functions it still misses; the spine is taken first.
function gainOrder(
  units: readonly FunctionUnit[],
  pairs: readonly Set<number>[],
  first: readonly FunctionUnit[],
): FunctionUnit[] {
  const missing = pairs.map((pair) => pair.size);
  const pairsOf = new Map<number, number[]>();

  pairs.forEach((pair, pairIndex) => {
    for (const id of pair) pairsOf.set(id, [...(pairsOf.get(id) ?? []), pairIndex]);
  });

  const remaining = new Set(units.filter((unit) => pairsOf.has(unit.id)).map((unit) => unit.id));
  const order: FunctionUnit[] = [];
  const take = (unit: FunctionUnit): void => {
    remaining.delete(unit.id);
    order.push(unit);

    for (const pairIndex of pairsOf.get(unit.id) ?? [])
      missing[pairIndex] = (missing[pairIndex] ?? 1) - 1;
  };

  for (const unit of first) take(unit);

  while (remaining.size > 0) {
    const best = bestNext(units, remaining, pairsOf, missing);

    if (best === undefined) break;

    take(best);
  }

  return order;
}

function bestNext(
  units: readonly FunctionUnit[],
  remaining: ReadonlySet<number>,
  pairsOf: ReadonlyMap<number, number[]>,
  missing: readonly number[],
): FunctionUnit | undefined {
  let best: FunctionUnit | undefined;
  let bestScore = -1;

  for (const id of remaining) {
    const unit = units[id];

    if (unit === undefined) continue;

    const gain = (pairsOf.get(id) ?? []).reduce((sum, pairIndex) => {
      const left = missing[pairIndex] ?? 1;

      return sum + 1 / (left * left);
    }, 0);
    const score = gain / unit.lines;

    if (score > bestScore) {
      bestScore = score;
      best = unit;
    }
  }

  return best;
}

function comparableCurve(
  pairs: readonly Set<number>[],
  briefOf: ReadonlyMap<number, number>,
  briefCount: number,
): number[] {
  const lastBrief = pairs.map((pair) =>
    Math.max(0, ...[...pair].map((id) => briefOf.get(id) ?? 0)),
  );

  return Array.from(
    { length: briefCount },
    (_, index) => lastBrief.filter((brief) => brief <= index + 1).length,
  );
}

/** The table text: a header line, then one row per function in brief order. */
export function coverageTable(coverage: CrateCoverage): string {
  const header = ["brief", "function", "file", "lines", "size", "pairs"].join("\t");
  const rows = coverage.rows.map(({ brief, unit, pairs }) =>
    [
      brief,
      unit.name,
      unit.file,
      `${unit.startLine}-${unit.endLine}`,
      unit.lines,
      `${pairs}/${coverage.pairCount}`,
    ].join("\t"),
  );

  return `${[header, ...rows].join("\n")}\n`;
}

// --- Coverage collection (runs only as a script) ---

interface ReachedFunction {
  file: string;
  startLine: number;
}

interface HalfRecord {
  half: string;
  reached: ReachedFunction[];
}

interface Part {
  run(draft: object, context: object): unknown;
}

interface PipelineModule {
  loadFsReader(root: string): object;
  pipelineDefaultParts(): { passes: Record<string, Part> };
  pipelineHalves: readonly string[];
  compileWorkspace(options: { reader: object; entry: string; parts: object }): unknown;
}

function isPipelineModule(value: unknown): value is PipelineModule {
  if (typeof value !== "object" || value === null) return false;

  return (
    ["loadFsReader", "pipelineDefaultParts", "compileWorkspace"].every(
      (name) => typeof Reflect.get(value, name) === "function",
    ) && Array.isArray(Reflect.get(value, "pipelineHalves"))
  );
}

interface ScriptInfo {
  url: string;
  sourceMapURL: string | undefined;
}

interface V8Function {
  functionName: string;
  ranges: { startOffset: number; endOffset: number; count: number }[];
}

interface V8Script {
  scriptId: string;
  url: string;
  functions: V8Function[];
}

/** V8 precise coverage in this thread: an in-thread inspector session answers synchronously. */
class CoverageProbe {
  readonly #session = new Session();
  readonly #scripts = new Map<string, ScriptInfo>();
  readonly #lineMappers = new Map<string, (offset: number) => number>();

  constructor() {
    this.#session.connect();
    this.#session.on("Debugger.scriptParsed", (event) => {
      this.#scripts.set(event.params.scriptId, {
        url: event.params.url,
        sourceMapURL: event.params.sourceMapURL,
      });
    });
    this.#post("Debugger.enable");
    this.#post("Profiler.enable");
    this.#post("Profiler.startPreciseCoverage", { callCount: true, detailed: false });
  }

  /** The functions of the sources reached since the last take; taking resets the counts. */
  take(): ReachedFunction[] {
    const answer = this.#post("Profiler.takePreciseCoverage");
    const scripts: unknown = Reflect.get(answer, "result");

    if (!Array.isArray(scripts)) throw new Error("takePreciseCoverage answered no script list");

    return (scripts as V8Script[]).flatMap((script) => this.#reachedIn(script));
  }

  #reachedIn(script: V8Script): ReachedFunction[] {
    if (!script.url.startsWith("file://")) return [];

    const path = fileURLToPath(script.url);
    const file = sourceFileOf(path);

    if (file === undefined) return [];

    const lineOf = this.#lineMapper(script.scriptId);
    const reached: ReachedFunction[] = [];

    for (const fn of script.functions) {
      const [range] = fn.ranges;

      if (range === undefined || range.count === 0) continue;

      // The module body itself.
      if (fn.functionName === "" && range.startOffset === 0) continue;

      reached.push({ file, startLine: lineOf(range.startOffset) });
    }

    return reached;
  }

  #lineMapper(scriptId: string): (offset: number) => number {
    const known = this.#lineMappers.get(scriptId);

    if (known !== undefined) return known;

    const source: unknown = Reflect.get(
      this.#post("Debugger.getScriptSource", { scriptId }),
      "scriptSource",
    );

    if (typeof source !== "string") throw new Error(`no source for script ${scriptId}`);

    const mapper = lineMapperOf(source, this.#scripts.get(scriptId)?.sourceMapURL);

    this.#lineMappers.set(scriptId, mapper);

    return mapper;
  }

  #post(method: string, parameters?: object): object {
    let answer: object | undefined;
    let failure: Error | null = null;

    this.#session.post(method, parameters, (error, result) => {
      failure = error;
      answer = result;
    });

    if (failure !== null) throw failure;

    return answer ?? {};
  }
}

const INLINE_MAP_PREFIX = "data:application/json;base64,";

// The 1-based TypeScript line of an offset of the executed JavaScript, through the inline source map when the
// type transform wrote one.
function lineMapperOf(
  source: string,
  sourceMapURL: string | undefined,
): (offset: number) => number {
  const lineStarts = [0];

  for (let index = 0; index < source.length; index++) {
    if (source[index] === "\n") lineStarts.push(index + 1);
  }

  const map = sourceMapURL?.startsWith(INLINE_MAP_PREFIX)
    ? new SourceMap(
        JSON.parse(
          Buffer.from(sourceMapURL.slice(INLINE_MAP_PREFIX.length), "base64").toString("utf8"),
        ),
      )
    : undefined;

  return (offset) => {
    const line = generatedLineOf(lineStarts, offset);

    if (map === undefined) return line + 1;

    const entry = map.findEntry(line, offset - (lineStarts[line] ?? 0));

    return "originalLine" in entry ? entry.originalLine + 1 : line + 1;
  };
}

function generatedLineOf(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low < high) {
    const middle = (low + high + 1) >> 1;

    if ((lineStarts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }

  return low;
}

// `compiler:<path under compiler/src>` or `spec:<path under spec/src>`, tests and test support left out.
function sourceFileOf(path: string): string | undefined {
  if (path.endsWith(".test.ts") || path.endsWith("test-support.ts")) return undefined;

  if (path.startsWith(`${COMPILER_SOURCES}/`)) return relative(COMPILER_SOURCES, path);

  if (path.startsWith(`${SPEC_SOURCES}/`)) return `spec:${relative(SPEC_SOURCES, path)}`;

  return undefined;
}

interface Collected {
  /** One record per half run, pairs of (fixture, api). */
  halves: HalfRecord[];
  /** One list per compiled fixture: what the compile reached outside the half runs. */
  compiles: ReachedFunction[][];
}

async function collect(): Promise<Collected> {
  const probe = new CoverageProbe();
  const pipeline: unknown = await import(pathToFileURL(join(COMPILER_SOURCES, "index.ts")).href);

  if (!isPipelineModule(pipeline))
    throw new Error(`${COMPILER_SOURCES} does not export the pipeline`);

  const excluded = readExcluded();
  const collected: Collected = { halves: [], compiles: [] };

  for (const fixture of discoverFixtures()) {
    if (fixture.path in excluded.fixtures) continue;

    const outsideHalves: ReachedFunction[] = [];
    const recordHalves = !(fixture.path in excluded.halves);
    const passes = Object.fromEntries(
      pipeline.pipelineHalves.map((half) => {
        const part = pipeline.pipelineDefaultParts().passes[half];

        if (part === undefined) throw new Error(`the default parts have no half ${half}`);

        const run = (draft: object, context: object): unknown => {
          outsideHalves.push(...probe.take());

          const result = part.run(draft, context);
          const reached = probe.take();

          if (recordHalves) collected.halves.push({ half, reached });

          return result;
        };

        return [half, { ...part, run }];
      }),
    );

    probe.take();
    pipeline.compileWorkspace({
      reader: pipeline.loadFsReader(fixture.directory),
      entry: fixture.entry,
      parts: { passes },
    });
    outsideHalves.push(...probe.take());
    collected.compiles.push(outsideHalves);
  }

  return collected;
}

// Every function of the crate's sources, moved functions applied.
function unitsOf(spec: CrateSpec): FunctionUnit[] {
  const files = spec.sources.flatMap((source) =>
    source.endsWith("/") ? filesUnder(source) : [source],
  );
  const isMovedOut = (file: string, name: string): boolean =>
    (spec.movedOut ?? []).some((moved) => moved === `${file}#${name}` || moved === `${file}#*`);
  const units: FunctionUnit[] = [];
  const add = (file: string, name: string, startLine: number, endLine: number): void => {
    units.push({
      id: units.length,
      file,
      name,
      startLine,
      endLine,
      lines: endLine - startLine + 1,
    });
  };

  for (const file of files) {
    for (const found of functionsOf(file)) {
      if (!isMovedOut(file, found.name)) add(file, found.name, found.startLine, found.endLine);
    }
  }

  for (const moved of spec.movedIn ?? []) {
    const [file = "", name = ""] = moved.split("#");
    const found = functionsOf(file).find((candidate) => candidate.name === name);

    if (found === undefined) throw new Error(`${spec.crate}: ${moved} names no function`);

    add(file, found.name, found.startLine, found.endLine);
  }

  return units;
}

function functionsOf(file: string): { name: string; startLine: number; endLine: number }[] {
  const path = join(COMPILER_SOURCES, file);

  return listTypeScriptFunctionRanges(path, readFileSync(path, "utf8"));
}

function filesUnder(directory: string): string[] {
  const root = join(COMPILER_SOURCES, directory);

  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((name) => join(root, name))
    .filter((path) => path.endsWith(".ts") && sourceFileOf(path) !== undefined)
    .map((path) => relative(COMPILER_SOURCES, path))
    .sort();
}

// The units of one crate reached by each pair: a reached V8 function counts for the innermost unit holding it.
function pairsOf(
  units: readonly FunctionUnit[],
  records: readonly ReachedFunction[][],
): Set<number>[] {
  return records.map((reached) => {
    const pair = new Set<number>();

    for (const { file, startLine } of reached) {
      const holder = units
        .filter(
          (unit) => unit.file === file && unit.startLine <= startLine && startLine <= unit.endLine,
        )
        .sort((left, right) => left.lines - right.lines)[0];

      if (holder !== undefined) pair.add(holder.id);
    }

    return pair;
  });
}

// The crate's functions reached while another half runs.
function calledElsewhere(
  spec: CrateSpec,
  units: readonly FunctionUnit[],
  collected: Collected,
): Set<number> {
  const otherRuns = collected.halves
    .filter((record) => record.half !== spec.pairs)
    .map((record) => record.reached);

  return new Set(pairsOf(units, otherRuns).flatMap((pair) => [...pair]));
}

function recordsOf(spec: CrateSpec, collected: Collected): ReachedFunction[][] {
  if (spec.pairs === COMPILE) return collected.compiles;

  return collected.halves
    .filter((record) => record.half === spec.pairs)
    .map((record) => record.reached);
}

// Directories of the compiler sources already ported in layer 1: their reach is no foreign helper.
const PORTED_DIRECTORIES = ["pipeline/", "derivations/", "diagnostics/", "load/"];

// The files a half reaches outside its own directory, with the pairs of each half reaching them: the cross-crate
// helpers of section 3 of the note.
function foreignTable(collected: Collected): string {
  const reachedBy = new Map<string, Map<string, number>>();

  for (const record of collected.halves) {
    for (const file of new Set(record.reached.map((reached) => reached.file))) {
      if (ownHalfFile(record.half, file) || isPortedFile(file)) continue;

      const perHalf = reachedBy.get(file) ?? new Map<string, number>();

      perHalf.set(record.half, (perHalf.get(record.half) ?? 0) + 1);
      reachedBy.set(file, perHalf);
    }
  }

  const rows = [...reachedBy]
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(
      ([file, perHalf]) =>
        `${file}\t${[...perHalf].map(([half, count]) => `${half} ${count}`).join(", ")}`,
    );

  return `${["file", "reached by (half pairs)"].join("\t")}\n${rows.join("\n")}\n`;
}

function isPortedFile(file: string): boolean {
  return (
    file === "raw-tree.ts" || PORTED_DIRECTORIES.some((directory) => file.startsWith(directory))
  );
}

function ownHalfFile(half: string, file: string): boolean {
  return file.startsWith(`passes/${half.replace(".", "/")}/`);
}

async function main(): Promise<void> {
  const collected = await collect();
  const crates = CRATES.map((spec) => ({ spec, units: unitsOf(spec) }));

  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });

  for (const { spec, units } of crates) {
    // A pair counts for a crate when it reaches one of its functions: a compile stopped by load is no pair of
    // validate.
    const pairs = pairsOf(units, recordsOf(spec, collected)).filter((pair) => pair.size > 0);
    const coverage = cutBriefs(
      units,
      pairs,
      spec.pullCalledElsewhere ? calledElsewhere(spec, units, collected) : new Set(),
    );
    const lines = units.reduce((sum, unit) => sum + unit.lines, 0);
    const briefLines = coverage.comparableAfterBrief.map((_, index) =>
      coverage.rows
        .filter((row) => row.brief === index + 1)
        .reduce((sum, row) => sum + row.unit.lines, 0),
    );

    writeFileSync(join(OUTPUT_DIRECTORY, `${spec.crate}.tsv`), coverageTable(coverage));
    console.log(
      `${spec.crate}: ${units.length} functions, ${lines} lines, ${coverage.pairCount} pairs, spine ${coverage.spineLines} lines, brief lines ${briefLines.join(" ")}, comparable after each brief ${coverage.comparableAfterBrief.join(" ")}`,
    );
  }

  writeFileSync(join(OUTPUT_DIRECTORY, "foreign.tsv"), foreignTable(collected));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
