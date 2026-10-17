import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { findOrphanFiles, findStaleFiles, generateIrModels, WRITE_COMMAND } from "./generate.ts";

// Writes or checks the native IR models. Run it through the resolve hook:
// node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts (--write | --check)

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE =
  "usage: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts (--write | --check)";

interface CliOptions {
  write?: boolean;
  check?: boolean;
}

function parseOptions(argv: string[]): CliOptions | string {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { write: { type: "boolean" }, check: { type: "boolean" } },
    });

    return values;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function main(argv: string[]): number {
  const values = parseOptions(argv);

  if (typeof values === "string") {
    console.error(`ir-models: ${values}\n${USAGE}`);

    return EXIT_USAGE;
  }

  if (values.write === values.check) {
    console.error(`ir-models: pass exactly one of --write and --check\n${USAGE}`);

    return EXIT_USAGE;
  }

  const files = generateIrModels();
  const orphans = findOrphanFiles(files, REPO_ROOT);
  const orphanDirectories = orphans.filter((orphan) => orphan.isDirectory);

  if (values.write === true && orphanDirectories.length > 0) {
    for (const { path } of orphanDirectories)
      console.error(
        `ir-models: ${path} is a directory the generator does not write; remove it by hand`,
      );

    return EXIT_FAILED;
  }

  if (values.write === true) {
    for (const { path } of orphans) rmSync(join(REPO_ROOT, path));

    for (const [path, content] of files) {
      mkdirSync(dirname(join(REPO_ROOT, path)), { recursive: true });
      writeFileSync(join(REPO_ROOT, path), content);
    }

    console.error(`ir-models: wrote ${files.size} files`);

    return EXIT_OK;
  }

  const stale = [
    ...findStaleFiles(files, REPO_ROOT),
    ...orphans.map(({ path }) => `${path} is no longer generated`),
  ];

  if (stale.length > 0) {
    for (const problem of stale) console.error(`ir-models: ${problem}`);
    console.error(`ir-models: run \`${WRITE_COMMAND}\` and commit the result`);

    return EXIT_FAILED;
  }

  console.error(`ir-models: ${files.size} files are current`);

  return EXIT_OK;
}

process.exitCode = main(process.argv.slice(2));
