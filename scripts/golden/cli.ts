import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { findStaleFiles } from "../ir-models/generate.ts";
import { loadGoldenCompiler } from "./compiler.ts";
import {
  allGeneratedFiles,
  findUnlistedFiles,
  packVariantContracts,
  WRITE_COMMAND,
} from "./golden.ts";
import { loadGoldenOpenApi } from "./openapi.ts";
import { REPO_ROOT } from "./repo-root.ts";

// Writes or checks the golden IR, its OpenAPI documents and the generated part of the scale fixture. Run it through the resolve hook, and
// with the flag that lets Node read the compiler's parameter properties:
// node --experimental-transform-types --import ./scripts/ir-models/register.ts scripts/golden/cli.ts (--write | --check)

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const USAGE =
  "usage: node --experimental-transform-types --import ./scripts/ir-models/register.ts scripts/golden/cli.ts (--write | --check)";

function parseOptions(argv: string[]): { write?: boolean; check?: boolean } | string {
  try {
    return parseArgs({
      args: argv,
      options: { write: { type: "boolean" }, check: { type: "boolean" } },
    }).values;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function writeFiles(files: ReadonlyMap<string, string>): void {
  for (const [path, content] of files) {
    mkdirSync(dirname(join(REPO_ROOT, path)), { recursive: true });
    writeFileSync(join(REPO_ROOT, path), content);
  }
}

async function main(argv: string[]): Promise<number> {
  const values = parseOptions(argv);

  if (typeof values === "string") {
    console.error(`golden: ${values}\n${USAGE}`);

    return EXIT_USAGE;
  }

  if (values.write === values.check) {
    console.error(`golden: pass exactly one of --write and --check\n${USAGE}`);

    return EXIT_USAGE;
  }

  // The variant contracts are compile inputs: they reach the disk before the cases are compiled.
  if (values.write === true) writeFiles(packVariantContracts(REPO_ROOT));

  const { files, problems } = allGeneratedFiles(
    REPO_ROOT,
    await loadGoldenCompiler(),
    await loadGoldenOpenApi(),
  );

  if (problems.length > 0) {
    for (const problem of problems) console.error(`golden: ${problem}`);

    return EXIT_FAILED;
  }

  const unlisted = findUnlistedFiles(files, REPO_ROOT);

  if (values.write === true) {
    for (const path of unlisted) rmSync(join(REPO_ROOT, path));

    writeFiles(files);

    console.error(`golden: wrote ${files.size} files`);

    return EXIT_OK;
  }

  const stale = [
    ...findStaleFiles(new Map(files), REPO_ROOT),
    ...unlisted.map((path) => `${path} is no longer generated`),
  ];

  if (stale.length > 0) {
    for (const problem of stale) console.error(`golden: ${problem}`);
    console.error(`golden: run \`${WRITE_COMMAND}\` and commit the result`);

    return EXIT_FAILED;
  }

  console.error(`golden: ${files.size} files are current`);

  return EXIT_OK;
}

process.exitCode = await main(process.argv.slice(2));
