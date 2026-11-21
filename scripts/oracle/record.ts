import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { jsonText } from "./expected-text.ts";
import { EXPECTED_ROOT, FIXTURES_ROOT, REPO_ROOT } from "./fixtures.ts";
import { RECORD_DIRECTORY_VARIABLE } from "./record-environment.ts";
import { loadOracleTools, type OracleTools } from "./tool-modules.ts";

// `node scripts/oracle/cli.ts record`: runs the OpenAPI and diff unit tests with their `emitDocuments` and
// `diffContracts` calls noted, and rewrites `fixtures/converted/openapi/` and `fixtures/converted/diff/` with one case per
// distinct input: the IR a test built (`ir.json`, or `before.ir.json` and `after.ir.json`) and the options it passed.
// An emit of an IR that a fixture already compiles to, with no options, adds nothing and is left out. The tests make
// hundreds of near-identical IRs, so a case is kept only when it shows something no kept case shows: a refusal code, an
// options value, the first success of a test file; a diff change kind with its classification, a refusal code, a gate outcome, a gate or
// exempt option.

const CONFIG = join(REPO_ROOT, "scripts/oracle/record.vitest.config.ts");
const OPENAPI_DIRECTORY = join(FIXTURES_ROOT, "converted/openapi");
const DIFF_DIRECTORY = join(FIXTURES_ROOT, "converted/diff");
const MAX_SLUG = 50;

// The IRs are big and the tests make hundreds: one line each, as the IR writer emits them.
const compactJson = (value: unknown): string => `${JSON.stringify(value)}\n`;

interface Note {
  kind: "openapi" | "diff";
  testPath: string;
  testName: string;
  ir?: unknown;
  before?: unknown;
  after?: unknown;
  options?: unknown;
}

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function notesOf(directory: string): Note[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Note),
    );
}

function fixtureIrDigests(): Set<string> {
  const digests = new Set<string>();

  for (const name of readdirSync(EXPECTED_ROOT, { recursive: true, encoding: "utf8" }))
    if (/(^|\/)ir\/[^/]+\.json$/.test(name))
      digests.add(digest(JSON.parse(readFileSync(join(EXPECTED_ROOT, name), "utf8"))));

  return digests;
}

const slugOf = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-$/, "");

function caseDirectory(root: string, note: Note, used: Set<string>): string {
  const stem = basename(note.testPath).replace(/\.test\.ts$/, "");
  const base = join(root, stem, slugOf(note.testName.split(" > ").slice(1).join(" ")) || "case");
  let candidate = base;

  for (let number = 2; used.has(candidate); number++) candidate = `${base}-${number}`;

  used.add(candidate);

  return candidate;
}

function writeOpenApiCase(directory: string, note: Note): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "ir.json"), compactJson(note.ir));

  if (note.options !== undefined)
    writeFileSync(join(directory, "openapi.options.json"), jsonText(note.options));
}

function writeDiffCase(directory: string, note: Note): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "before.ir.json"), compactJson(note.before));
  writeFileSync(join(directory, "after.ir.json"), compactJson(note.after));

  if (note.options !== undefined)
    writeFileSync(join(directory, "diff.options.json"), jsonText(note.options));
}

function openApiFeatures(tools: OracleTools, note: Note): string[] {
  const parsed = tools.parseEmitterOptions(note.options);

  if (parsed.status === "refused")
    throw new Error(`recorded emitter options refused: ${JSON.stringify(note.options)}`);

  const outcome = tools.emitDocuments(note.ir as object, parsed.options);
  const stem = basename(note.testPath);
  const optionFeature = note.options === undefined ? [] : [`options:${digest(note.options)}`];

  return outcome.status === "refused"
    ? [...optionFeature, ...outcome.refusals.map(({ code }) => `refusal:${code}`)]
    : [...optionFeature, `emitted:${stem}`];
}

function diffFeatures(tools: OracleTools, note: Note): string[] {
  const options = (note.options ?? {}) as { gate?: unknown; exempt?: unknown };
  const result = tools.diffContracts(
    note.before as object,
    note.after as object,
    note.options ?? {},
  ) as {
    ok: boolean;
    changes?: { kind: string; classification: string }[];
    refusals?: { code: string }[];
    gate?: { passed: boolean };
    deprecations?: unknown[];
  };
  const optionFeatures = [options.gate, options.exempt].some((value) => value !== undefined)
    ? [`options:${digest([options.gate, options.exempt])}`]
    : [];

  return [
    ...optionFeatures,
    `gate:${result.gate?.passed}`,
    ...(result.deprecations?.length ? ["deprecations"] : []),
    ...(result.refusals ?? []).map(({ code }) => `refusal:${code}`),
    ...(result.changes ?? []).map((change) => `${change.kind}/${change.classification}`),
  ];
}

export async function recordCommand(): Promise<string> {
  const tools = await loadOracleTools();

  const notesDirectory = mkdtempSync(join(tmpdir(), "seampact-oracle-record-"));

  try {
    const run = spawnSync("pnpm", ["exec", "vitest", "run", "--config", CONFIG], {
      cwd: REPO_ROOT,
      env: { ...process.env, [RECORD_DIRECTORY_VARIABLE]: notesDirectory },
      stdio: ["ignore", "ignore", "inherit"],
    });

    if (run.status !== 0)
      throw new Error(`the recording run of the unit tests failed (exit ${run.status})`);

    rmSync(OPENAPI_DIRECTORY, { recursive: true, force: true });
    rmSync(DIFF_DIRECTORY, { recursive: true, force: true });

    const known = fixtureIrDigests();
    const seen = new Set<string>();
    const used = new Set<string>();
    const counts = { openapi: 0, diff: 0 };
    const shown = new Set<string>();

    const showsSomethingNew = (features: readonly string[]): boolean => {
      const fresh = features.filter((feature) => !shown.has(`${feature}`));

      for (const feature of features) shown.add(feature);

      return fresh.length > 0;
    };

    for (const note of notesOf(notesDirectory)) {
      const key = digest([note.kind, note.ir, note.before, note.after, note.options]);

      if (seen.has(key)) continue;

      seen.add(key);

      if (note.kind === "openapi") {
        if (note.options === undefined && known.has(digest(note.ir))) continue;

        if (!showsSomethingNew(openApiFeatures(tools, note))) continue;

        writeOpenApiCase(caseDirectory(OPENAPI_DIRECTORY, note, used), note);
        counts.openapi++;
      } else {
        if (digest(note.before) === digest(note.after)) continue;

        if (!showsSomethingNew(diffFeatures(tools, note))) continue;

        writeDiffCase(caseDirectory(DIFF_DIRECTORY, note, used), note);
        counts.diff++;
      }
    }

    return `oracle: recorded ${counts.openapi} openapi cases and ${counts.diff} diff cases`;
  } finally {
    rmSync(notesDirectory, { recursive: true, force: true });
  }
}
