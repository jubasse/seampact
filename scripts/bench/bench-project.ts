import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPackages, packPackages } from "../consumers/build-and-pack.ts";
import {
  assembleConsumer,
  COMMIT_FILE,
  prepareConsumerDirectory,
  useTarballs,
  VENDOR_DIRECTORY,
} from "../consumers/consumer-project.ts";
import { runStep } from "../consumers/run-step.ts";
import { validatorChoice } from "../consumers/validator-choice.ts";
import { REPO_ROOT } from "../golden/repo-root.ts";
import type { BenchPair } from "./pairs.ts";

const CONSUMERS_ROOT = join(REPO_ROOT, "scripts/consumers");
const BENCH_SOURCES = join(REPO_ROOT, "scripts/bench/project");
const BENCH_DIRECTORY = "bench";
const TARBALLS_DIRECTORY = "tarballs";

// The load tool and the TypeScript loader the bench servers run on, installed in each assembled project so the
// repository's own dependencies stay unchanged.
const BENCH_DEPENDENCIES = { autocannon: "8.0.0", tsx: "4.23.15" } as const;

// tsx depends on esbuild, whose install script pnpm refuses unless it is approved; esbuild runs without it.
const INSTALL_WITHOUT_BUILD_SCRIPT_CHECK = "--config.strictDepBuilds=false";

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

  return { directory, byPackage: packPackages(REPO_ROOT, directory) };
}

// The assembled project of a pair, installed and generated; with `reuse`, the project of an earlier run on the
// same commit keeps its install and only takes the bench sources again. The packages build and pack when the
// first project needs them.
export function prepareProject(options: {
  readonly pair: BenchPair;
  readonly workDirectory: string;
  readonly tarballs: () => PackedTarballs;
  readonly reuse: boolean;
}): string {
  const directory = join(options.workDirectory, options.pair.id);
  const commit = currentCommit();

  if (options.reuse && isProjectOfCommit(directory, commit)) {
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
    extras: {
      sourceDirectory: BENCH_SOURCES,
      into: BENCH_DIRECTORY,
      dependencies: BENCH_DEPENDENCIES,
    },
  });
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

  return directory;
}

function isProjectOfCommit(directory: string, commit: string): boolean {
  const marker = join(directory, COMMIT_FILE);

  return (
    existsSync(marker) &&
    existsSync(join(directory, "node_modules")) &&
    readFileSync(marker, "utf8").trim() === commit
  );
}
