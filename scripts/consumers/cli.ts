import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT as REPOSITORY_ROOT } from "../golden/repo-root.ts";
import { buildPackages, packPackages } from "./build-and-pack.ts";
import {
  assembleConsumer,
  prepareConsumerDirectory,
  TARGET_ID,
  useTarballs,
  VENDOR_DIRECTORY,
} from "./consumer-project.ts";
import { runLocalStep, runStep, StepFailure } from "./run-step.ts";

// Builds and packs the seampact packages, assembles a test consumer from the template and a target overlay, and
// installs, generates, typechecks and tests it as a user would (ADR 0011 "Unpublished installs for test
// consumers"). The first failing step ends the run with its exit code.
// node scripts/consumers/cli.ts --target <id> [--dir <path>]

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = "usage: node scripts/consumers/cli.ts --target <id> [--dir <path>]";
const CONSUMERS_ROOT = join(REPOSITORY_ROOT, "scripts/consumers");

interface RunOptions {
  readonly target: string;
  readonly directory: string;
}

function parseOptions(argv: string[]): RunOptions | string {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { target: { type: "string" }, dir: { type: "string" } },
    });

    if (values.target === undefined) return "pass --target <id>";

    if (!TARGET_ID.test(values.target)) {
      return `--target '${values.target}' is not a target id: use lowercase letters, digits and dashes (${TARGET_ID.source}).`;
    }

    return {
      target: values.target,
      directory: resolve(values.dir ?? join(homedir(), "Dev", `test-seampact-${values.target}`)),
    };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function runConsumer({ target, directory }: RunOptions): void {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT })
    .toString()
    .trim();

  buildPackages(REPOSITORY_ROOT);
  runLocalStep(`assemble the '${target}' consumer in ${directory}`, () => {
    prepareConsumerDirectory(directory);
    assembleConsumer({
      consumersRoot: CONSUMERS_ROOT,
      repositoryRoot: REPOSITORY_ROOT,
      target,
      directory,
      commit,
    });
  });

  const tarballs = packPackages(REPOSITORY_ROOT, join(directory, VENDOR_DIRECTORY));

  runLocalStep("list the tarballs in the consumer's package.json", () =>
    useTarballs(directory, tarballs),
  );

  for (const [title, args] of [
    ["install", ["install", "--no-frozen-lockfile"]],
    ["generate", ["exec", "seampact", "generate"]],
    ["typecheck", ["exec", "tsc", "--noEmit"]],
    ["test", ["exec", "vitest", "run"]],
  ] as const) {
    runStep({ title, command: "pnpm", args, cwd: directory });
  }
}

function main(argv: string[]): number {
  const options = parseOptions(argv);

  if (typeof options === "string") {
    console.error(`consumers: ${options}\n${USAGE}`);

    return EXIT_USAGE;
  }

  try {
    runConsumer(options);
  } catch (error) {
    if (error instanceof StepFailure) {
      console.error(error.message);

      return error.exitCode;
    }

    console.error(error instanceof Error ? error.message : String(error));

    return EXIT_FAILED;
  }

  console.log(`\nconsumers: the '${options.target}' consumer in ${options.directory} passes.`);

  return EXIT_OK;
}

process.exitCode = main(process.argv.slice(2));
