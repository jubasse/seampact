import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT as REPOSITORY_ROOT } from "../golden/repo-root.ts";
import { buildPackages, packPackages } from "./build-and-pack.ts";
import { useTarballs, VENDOR_DIRECTORY } from "./consumer-project.ts";
import { ignoreVendorDirectory } from "./ignore-vendor.ts";
import { StepFailure, type StepOutput } from "./run-step.ts";

// Builds and packs this checkout's seampact packages into `<app>/vendor/seampact` and lists them in the app's
// package.json and pnpm overrides, so `pnpm install` resolves them without npm (ADR 0011 "Unpublished installs
// for test consumers"). The app already holds a package.json.
// node scripts/consumers/install-into.ts <app-dir>

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE = "usage: node scripts/consumers/install-into.ts <app-dir>";
const PACKAGE_FILE = "package.json";
const QUIET: StepOutput = "onFailure";

function parseDirectory(argv: string[]): string {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true });
  const [directory, ...extra] = positionals;

  if (directory === undefined || extra.length > 0) throw new UsageError("pass one <app-dir>");

  const absolute = resolve(directory);

  if (!existsSync(join(absolute, PACKAGE_FILE))) {
    throw new UsageError(`${absolute} has no ${PACKAGE_FILE}: create the app's package.json first`);
  }

  return absolute;
}

class UsageError extends Error {}

function main(argv: string[]): number {
  let directory: string;

  try {
    directory = parseDirectory(argv);
  } catch (error) {
    console.error(
      `install-into: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`,
    );

    return EXIT_USAGE;
  }

  try {
    buildPackages(REPOSITORY_ROOT, QUIET);

    const tarballs = packPackages(REPOSITORY_ROOT, join(directory, VENDOR_DIRECTORY), QUIET);

    useTarballs(directory, tarballs);
    ignoreVendorDirectory(directory);
    console.log(
      `install-into: ${tarballs.size} packages in ${join(directory, VENDOR_DIRECTORY)}, listed in package.json. Run pnpm install.`,
    );
  } catch (error) {
    if (error instanceof StepFailure) {
      console.error(error.message);

      return error.exitCode;
    }

    console.error(error instanceof Error ? error.message : String(error));

    return EXIT_FAILED;
  }

  return EXIT_OK;
}

process.exitCode = main(process.argv.slice(2));
