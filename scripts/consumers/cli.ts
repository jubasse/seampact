import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT as REPOSITORY_ROOT } from "../golden/repo-root.ts";
import { buildPackages, packPackages } from "./build-and-pack.ts";
import {
  assembleConsumer,
  prepareConsumerDirectory,
  TARGET_ID,
  parseTargetOptions,
  type TargetOption,
  useTarballs,
  VENDOR_DIRECTORY,
} from "./consumer-project.ts";
import { runLocalStep, runStep, runStepExpectingFailure, StepFailure } from "./run-step.ts";
import {
  DEFAULT_VALIDATOR_CHOICE,
  isValidatorChoice,
  knownValidatorChoices,
  validatorChoice,
} from "./validator-choice.ts";

// Builds and packs the seampact packages, assembles a test consumer from the template and a target overlay, and
// installs (with the Playwright browser when an overlay adds a browser project), generates, typechecks and tests it as
// a user would (ADR 0011 "Unpublished installs for test consumers"). The first failing step ends the run with its exit code.
// node scripts/consumers/cli.ts --target <id> [--validators <id>] [--target-option <key>=<value>]... [--dir <path>]
// A target option is written into the target's config entries; one the target does not know fails `generate`, named.

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE =
  "usage: node scripts/consumers/cli.ts --target <id> [--validators <id>] [--target-option <key>=<value>]... [--dir <path>]";
const CONSUMERS_ROOT = join(REPOSITORY_ROOT, "scripts/consumers");

interface RunOptions {
  readonly target: string;
  readonly validators: string;
  readonly targetOptions: readonly TargetOption[];
  readonly directory: string;
}

function parseOptions(argv: string[]): RunOptions | string {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        target: { type: "string" },
        validators: { type: "string", default: DEFAULT_VALIDATOR_CHOICE },
        "target-option": { type: "string", multiple: true, default: [] },
        dir: { type: "string" },
      },
    });

    if (values.target === undefined) return "pass --target <id>";

    if (!TARGET_ID.test(values.target)) {
      return `--target '${values.target}' is not a target id: use lowercase letters, digits and dashes (${TARGET_ID.source}).`;
    }

    if (!isValidatorChoice(values.validators)) {
      return `--validators '${values.validators}' is not a validator choice: use one of ${knownValidatorChoices()}.`;
    }

    const targetOptions = parseTargetOptions(values["target-option"]);

    if (typeof targetOptions === "string") return targetOptions;

    return {
      target: values.target,
      validators: values.validators,
      targetOptions,
      directory: resolve(
        values.dir ?? defaultDirectory(values.target, values.validators, targetOptions),
      ),
    };
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// The default validators without target options keep the target's directory; another choice gets its own.
function defaultDirectory(
  target: string,
  validators: string,
  targetOptions: readonly TargetOption[],
): string {
  const suffixes = [
    ...(validators === DEFAULT_VALIDATOR_CHOICE ? [] : [validators]),
    ...targetOptions.map(({ key, value }) => `${key}-${value}`),
  ];

  return join(homedir(), "Dev", ["test-seampact", target, ...suffixes].join("-"));
}

function runConsumer({ target, validators, targetOptions, directory }: RunOptions): void {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPOSITORY_ROOT })
    .toString()
    .trim();

  buildPackages(REPOSITORY_ROOT);
  runLocalStep(`assemble the '${target}' consumer on ${validators} in ${directory}`, () => {
    prepareConsumerDirectory(directory);
    assembleConsumer({
      consumersRoot: CONSUMERS_ROOT,
      repositoryRoot: REPOSITORY_ROOT,
      target,
      validators: validatorChoice(validators),
      directory,
      commit,
      targetOptions,
    });
  });

  const tarballs = packPackages(REPOSITORY_ROOT, join(directory, VENDOR_DIRECTORY));

  runLocalStep("list the tarballs in the consumer's package.json", () =>
    useTarballs(directory, tarballs),
  );

  runStep({
    title: "install",
    command: "pnpm",
    args: ["install", "--no-frozen-lockfile"],
    cwd: directory,
  });

  if (hasBrowserProject(directory)) {
    runStep({
      title: "install the Playwright Chromium headless shell",
      command: "pnpm",
      args: ["exec", "playwright", "install", "--only-shell", "chromium"],
      cwd: directory,
    });
  }

  for (const [title, args] of [
    ["generate", ["exec", "seampact", "generate"]],
    ["check", ["exec", "seampact", "check"]],
    ["typecheck", ["exec", "tsc", "--noEmit"]],
    ["test", ["exec", "vitest", "run"]],
  ] as const) {
    runStep({ title, command: "pnpm", args, cwd: directory });
  }

  checkNamesHandEdit(directory);
}

// The package a consumer's overlays add for a Vitest browser project, whose browser the run installs.
const BROWSER_PROVIDER_PACKAGE = "playwright";

interface ConsumerDependencies {
  dependencies?: Record<string, string>;
}

function hasBrowserProject(directory: string): boolean {
  const manifest: ConsumerDependencies = JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  );

  return Object.hasOwn(manifest.dependencies ?? {}, BROWSER_PROVIDER_PACKAGE);
}

// The directory whose generated files the hand edit changes, and its manifest (ADR 0015 "Writing files").
const EDITED_OUTPUT_DIRECTORY = "generated/types/tasks";
const MANIFEST_FILE = ".seampact-manifest.json";

interface OutputManifest {
  files: { path: string }[];
}

// A generated file edited by hand makes `check` fail naming the file; the file is restored afterwards.
function checkNamesHandEdit(directory: string): void {
  const outputDirectory = join(directory, EDITED_OUTPUT_DIRECTORY);
  const manifest: OutputManifest = JSON.parse(
    readFileSync(join(outputDirectory, MANIFEST_FILE), "utf8"),
  );
  const [first] = manifest.files;

  if (first === undefined) throw new Error(`consumers: ${EDITED_OUTPUT_DIRECTORY} lists no file`);

  const file = join(outputDirectory, first.path);
  const original = readFileSync(file, "utf8");

  writeFileSync(file, `${original}// edited by hand\n`);

  try {
    runStepExpectingFailure(
      {
        title: "check after a hand edit",
        command: "pnpm",
        args: ["exec", "seampact", "check"],
        cwd: directory,
      },
      first.path,
    );
  } finally {
    writeFileSync(file, original);
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
