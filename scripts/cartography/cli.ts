import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildCartography, CARTOGRAPHY_FILE, COMPILER_STAGES, WRITE_COMMAND } from "./map.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

function main(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string" },
      write: { type: "boolean" },
      check: { type: "boolean" },
    },
  });
  if (values.write === values.check) {
    console.error("cartography: pass exactly one of --write and --check");
    return EXIT_USAGE;
  }

  const root = resolve(values.root ?? REPO_ROOT);
  const { markdown, problems } = buildCartography({ root, stages: COMPILER_STAGES });
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`cartography: ${problems.length} problem(s), ${CARTOGRAPHY_FILE} not written`);
    return EXIT_FAILED;
  }

  const target = join(root, CARTOGRAPHY_FILE);
  if (values.write === true) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, markdown);
    console.error(`cartography: wrote ${CARTOGRAPHY_FILE}`);
    return EXIT_OK;
  }

  const committed = existsSync(target) ? readFileSync(target, "utf8") : undefined;
  if (committed !== markdown) {
    const state = committed === undefined ? "is missing" : "is stale";
    console.error(
      `cartography: ${CARTOGRAPHY_FILE} ${state}; run \`${WRITE_COMMAND}\` and commit it`,
    );
    return EXIT_FAILED;
  }
  console.error("cartography: ok");
  return EXIT_OK;
}

process.exitCode = main(process.argv.slice(2));
