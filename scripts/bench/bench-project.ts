import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPackages, packPackages } from "../consumers/build-and-pack.ts";
import {
  assembleConsumer,
  prepareConsumerDirectory,
  useTarballs,
  VENDOR_DIRECTORY,
} from "../consumers/consumer-project.ts";
import { runStep } from "../consumers/run-step.ts";
import { validatorChoice } from "../consumers/validator-choice.ts";
import { REPO_ROOT } from "../golden/repo-root.ts";
import type { BenchPair } from "./pairs.ts";
import { checkTarballContents } from "./tarball-check.ts";

const CONSUMERS_ROOT = join(REPO_ROOT, "scripts/consumers");
const BENCH_SOURCES = join(REPO_ROOT, "scripts/bench/project");
const BENCH_DIRECTORY = "bench";
const TARBALLS_DIRECTORY = "tarballs";

// The load tool and the TypeScript loader the bench servers run on, installed in each assembled project so the
// repository's own dependencies stay unchanged.
const BENCH_DEPENDENCIES = { autocannon: "8.0.0", tsx: "4.23.15" } as const;

// tsx depends on esbuild, whose install script pnpm refuses unless it is approved; esbuild runs without it.
const INSTALL_WITHOUT_BUILD_SCRIPT_CHECK = "--config.strictDepBuilds=false";

// Written last, once install and generate succeeded: a project without it is stale.
const READY_FILE = ".bench-ready";
const KEYED_PATHS = ["packages", "scripts/consumers", "scripts/bench/project"];
const CONFIG_FILE = "seampact.config.yaml";
const BODY_VALIDATION_ON = "bodyValidation: true";
const BODY_VALIDATION_OFF = "bodyValidation: false";

export function currentCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }).toString().trim();
}

export interface PackedTarballs {
  readonly directory: string;
  readonly byPackage: ReadonlyMap<string, string>;
}

// Builds the seampact packages and packs them once for every project of the run.
export function packOnce(workDirectory: string): PackedTarballs {
  const directory = join(workDirectory, TARBALLS_DIRECTORY);

  buildPackages(REPO_ROOT);

  const byPackage = packPackages(REPO_ROOT, directory);

  for (const file of byPackage.values()) checkTarballContents(join(directory, file));

  return { directory, byPackage };
}

// The assembled project of a pair, installed and generated. A project of an earlier run on the same commit is
// cached under the work directory and only takes the bench sources again, unless `fresh` asks for a rebuild or
// `packages/` has uncommitted changes (the cache holds the packages packed from the commit). The packages build
// and pack when the first project that needs them is assembled.
export function prepareProject(options: {
  readonly pair: BenchPair;
  readonly workDirectory: string;
  readonly tarballs: () => PackedTarballs;
  readonly fresh: boolean;
}): string {
  const directory = join(options.workDirectory, options.pair.id);
  const commit = currentCommit();

  const sourceKey = cacheKey(commit, options.pair);

  if (!options.fresh && isProjectOfKey(directory, sourceKey)) {
    cpSync(BENCH_SOURCES, join(directory, BENCH_DIRECTORY), { recursive: true });

    return directory;
  }

  prepareConsumerDirectory(directory);
  assembleConsumer({
    consumersRoot: CONSUMERS_ROOT,
    repositoryRoot: REPO_ROOT,
    target: options.pair.overlay,
    validators: validatorChoice(options.pair.validators),
    directory,
    commit,
    targetOptions: options.pair.targetOptions,
    extras: {
      sourceDirectory: BENCH_SOURCES,
      into: BENCH_DIRECTORY,
      dependencies: BENCH_DEPENDENCIES,
    },
  });

  if (!options.pair.bodyValidation) switchBodyValidationOff(directory);

  mkdirSync(join(directory, VENDOR_DIRECTORY), { recursive: true });
  const tarballs = options.tarballs();

  cpSync(tarballs.directory, join(directory, VENDOR_DIRECTORY), { recursive: true });
  useTarballs(directory, tarballs.byPackage);
  runStep({
    title: `install ${options.pair.id}`,
    command: "pnpm",
    args: ["install", "--no-frozen-lockfile", INSTALL_WITHOUT_BUILD_SCRIPT_CHECK],
    cwd: directory,
  });
  runStep({
    title: `generate ${options.pair.id}`,
    command: "pnpm",
    args: ["exec", "seampact", "generate"],
    cwd: directory,
  });
  writeFileSync(join(directory, READY_FILE), `${sourceKey}\n`);

  return directory;
}

function isProjectOfKey(directory: string, key: string): boolean {
  const marker = join(directory, READY_FILE);

  return existsSync(marker) && readFileSync(marker, "utf8").trim() === key;
}

// The consumer config of every target turns the outgoing body check on; the second row of a pair turns it off.
function switchBodyValidationOff(directory: string): void {
  const file = join(directory, CONFIG_FILE);
  const config = readFileSync(file, "utf8");

  if (!config.includes(BODY_VALIDATION_ON)) {
    throw new Error(`bench: ${file} has no '${BODY_VALIDATION_ON}' to switch off.`);
  }

  writeFileSync(file, config.replaceAll(BODY_VALIDATION_ON, BODY_VALIDATION_OFF));
}

// What a project is built from: the commit plus every uncommitted change (tracked diff and untracked file
// contents) under the packages, the consumer template and overlays, and the bench sources, and the pair's run
// settings.
function cacheKey(commit: string, pair: BenchPair): string {
  const hash = createHash("sha256")
    .update(commit)
    .update(
      JSON.stringify({ targetOptions: pair.targetOptions, appInterceptor: pair.appInterceptor }),
    );
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 });

  hash.update(git(["diff", "HEAD", "--", ...KEYED_PATHS]));

  const untracked = git(["ls-files", "-o", "--exclude-standard", "-z", "--", ...KEYED_PATHS])
    .toString()
    .split("\0")
    .filter((file) => file !== "");

  for (const file of untracked) hash.update(file).update(readFileSync(join(REPO_ROOT, file)));

  return `${commit}:${hash.digest("hex")}`;
}
