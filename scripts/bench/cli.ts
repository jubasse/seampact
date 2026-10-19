import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "../golden/repo-root.ts";
import { currentCommit, type PackedTarballs, packOnce, prepareProject } from "./bench-project.ts";
import { benchPairs, selectPairs, withoutBodyValidation } from "./pairs.ts";
import { profilePair } from "./profile.ts";
import type { BenchResults, PairMeasurement } from "./results.ts";
import { type MeasureOptions, measurePair, probePair } from "./run-pair.ts";
import { compareTable, summaryTable } from "./summary.ts";

// Measures each seampact server against the same routes hand-written on the bare framework, locally: for every
// pair of the compatibility matrix (a target, its framework major, a validator library) it assembles one project,
// proves both servers answer alike, then runs load on both. Results are written under `--out`, never committed.
// node scripts/bench/cli.ts --target <overlay> --validators <id> [--route <id>] [--duration <s>] [--out <dir>]
// node scripts/bench/cli.ts --all [--check] | --profile --target <overlay> --validators <id> --route <id>

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE =
  "usage: node scripts/bench/cli.ts (--all | --target <overlay> --validators <id>) [--check] [--body-validation <on|off|both>] [--profile] [--route <ids>] [--duration <s>] [--warmup <s>] [--repeats <n>] [--connections <n>] [--out <dir>] [--work <dir>] [--reuse] [--compare <results.json>]";
const CONSUMERS_ROOT = join(REPO_ROOT, "scripts/consumers");
const DEFAULT_OUT = join(REPO_ROOT, ".bench-output/latest");
const DEFAULT_WORK = join(tmpdir(), "seampact-bench");
const BODY_VALIDATION_CHOICES = ["on", "off", "both"] as const;

type BodyValidationChoice = (typeof BODY_VALIDATION_CHOICES)[number];
const DEFAULT_ROUTES = [
  "health",
  "getChannel",
  "updateTask",
  "listTasks",
  "payments",
  "createTask",
];
const DEFAULT_DURATION_SECONDS = 10;
const DEFAULT_WARMUP_SECONDS = 3;
const DEFAULT_REPEATS = 3;
const DEFAULT_CONNECTIONS = 10;

interface Invocation {
  readonly all: boolean;
  readonly target?: string;
  readonly validators?: string;
  readonly check: boolean;
  readonly profile: boolean;
  readonly reuse: boolean;
  readonly bodyValidation: BodyValidationChoice;
  readonly out: string;
  readonly work: string;
  readonly compare?: string;
  readonly measure: MeasureOptions;
}

function parseInvocation(argv: string[]): Invocation | string {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        all: { type: "boolean", default: false },
        target: { type: "string" },
        validators: { type: "string" },
        route: { type: "string" },
        duration: { type: "string", default: String(DEFAULT_DURATION_SECONDS) },
        warmup: { type: "string", default: String(DEFAULT_WARMUP_SECONDS) },
        repeats: { type: "string", default: String(DEFAULT_REPEATS) },
        connections: { type: "string", default: String(DEFAULT_CONNECTIONS) },
        out: { type: "string" },
        work: { type: "string" },
        check: { type: "boolean", default: false },
        profile: { type: "boolean", default: false },
        reuse: { type: "boolean", default: false },
        "body-validation": { type: "string", default: "both" },
        compare: { type: "string" },
      },
    });

    if (!values.all && (values.target === undefined || values.validators === undefined)) {
      return "pass --all, or --target <overlay> and --validators <id>";
    }

    const bodyValidation = BODY_VALIDATION_CHOICES.find(
      (choice) => choice === values["body-validation"],
    );

    if (bodyValidation === undefined) {
      return `--body-validation '${values["body-validation"]}' is not one of ${BODY_VALIDATION_CHOICES.join(", ")}.`;
    }

    const numbers = {
      durationSeconds: positiveNumber("--duration", values.duration),
      warmupSeconds: positiveNumber("--warmup", values.warmup),
      repeats: positiveNumber("--repeats", values.repeats),
      connections: positiveNumber("--connections", values.connections),
    };
    const failed = Object.values(numbers).find((value) => typeof value === "string");

    if (typeof failed === "string") return failed;

    return {
      all: values.all,
      ...(values.target === undefined ? {} : { target: values.target }),
      ...(values.validators === undefined ? {} : { validators: values.validators }),
      check: values.check,
      profile: values.profile,
      reuse: values.reuse,
      bodyValidation,
      out: resolve(values.out ?? DEFAULT_OUT),
      work: resolve(values.work ?? DEFAULT_WORK),
      ...(values.compare === undefined ? {} : { compare: resolve(values.compare) }),
      measure: {
        routeIds: values.route === undefined ? DEFAULT_ROUTES : values.route.split(","),
        durationSeconds: Number(numbers.durationSeconds),
        warmupSeconds: Number(numbers.warmupSeconds),
        repeats: Number(numbers.repeats),
        connections: Number(numbers.connections),
      },
    };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function positiveNumber(flag: string, text: string | undefined): number | string {
  const value = Number(text);

  return Number.isFinite(value) && value > 0
    ? value
    : `${flag} '${text}' is not a positive number.`;
}

async function checkPairs(invocation: Invocation): Promise<number> {
  const pairs = selectedPairs(invocation);
  const tarballs = packedOnDemand(invocation.work);
  let failures = 0;

  for (const pair of pairs) {
    const directory = prepareProject({
      pair,
      workDirectory: invocation.work,
      tarballs,
      reuse: invocation.reuse,
    });
    const differences = await probePair(pair, directory);

    if (differences.length === 0) console.log(`parity ${pair.id}: ok`);
    else console.log(`parity ${pair.id}: FAILED\n  ${differences.join("\n  ")}`);

    failures += differences.length === 0 ? 0 : 1;
  }

  console.log(
    `\nbench: ${pairs.length - failures} of ${pairs.length} pairs answer alike on both servers.`,
  );

  return failures === 0 ? EXIT_OK : EXIT_FAILED;
}

// The packages build and pack once, when the first project to assemble asks for them.
function packedOnDemand(work: string): () => PackedTarballs {
  let packed: PackedTarballs | undefined;

  return () => {
    packed ??= packOnce(work);

    return packed;
  };
}

function selectedPairs(invocation: Invocation) {
  return selectPairs(benchPairs(CONSUMERS_ROOT), {
    all: invocation.all,
    ...(invocation.target === undefined ? {} : { target: invocation.target }),
    ...(invocation.validators === undefined ? {} : { validators: invocation.validators }),
  });
}

// A measuring run reports each pair with the generated server's outgoing body check on, off, or both rows.
function measuredPairs(invocation: Invocation) {
  return selectedPairs(invocation).flatMap((pair) => {
    if (invocation.bodyValidation === "on") return [pair];

    if (invocation.bodyValidation === "off") return [withoutBodyValidation(pair)];

    return [pair, withoutBodyValidation(pair)];
  });
}

async function runMeasurements(invocation: Invocation): Promise<number> {
  const pairs = measuredPairs(invocation);
  const tarballs = packedOnDemand(invocation.work);
  const startedAt = new Date().toISOString();
  const measured: PairMeasurement[] = [];

  for (const pair of pairs) {
    const directory = prepareProject({
      pair,
      workDirectory: invocation.work,
      tarballs,
      reuse: invocation.reuse,
    });

    console.log(`\nbench: measuring ${pair.id} (load average ${loadavg()[0]?.toFixed(2)})`);
    measured.push(await measurePair(pair, directory, invocation.measure));
  }

  const results: BenchResults = {
    commit: currentCommit(),
    node: process.version,
    startedAt,
    durationSeconds: invocation.measure.durationSeconds,
    repeats: invocation.measure.repeats,
    pairs: measured,
  };

  mkdirSync(invocation.out, { recursive: true });
  writeFileSync(join(invocation.out, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(join(invocation.out, "summary.md"), `${summaryTable(results)}\n`);
  console.log(`\n${summaryTable(results)}`);

  if (invocation.compare !== undefined) {
    const before: BenchResults = JSON.parse(readFileSync(invocation.compare, "utf8"));

    console.log(`\n${compareTable(before, results)}`);
  }

  console.log(`\nbench: results written to ${invocation.out}.`);

  return EXIT_OK;
}

async function main(argv: string[]): Promise<number> {
  const invocation = parseInvocation(argv);

  if (typeof invocation === "string") {
    console.error(`bench: ${invocation}\n${USAGE}`);

    return EXIT_USAGE;
  }

  try {
    if (invocation.profile)
      return await profilePair(
        { ...invocation, measure: invocation.measure },
        selectedPairs(invocation),
      );

    return invocation.check ? await checkPairs(invocation) : await runMeasurements(invocation);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));

    return EXIT_FAILED;
  }
}

process.exitCode = await main(process.argv.slice(2));
