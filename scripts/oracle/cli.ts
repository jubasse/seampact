import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkFixtures,
  checkReport,
  coverageCommand,
  selectedFixtures,
  writeCommand,
} from "./commands.ts";

// The oracle CLI: `node scripts/oracle/cli.ts write|check [<fixture glob>]` and `coverage` (see README.md).

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const USAGE = "usage: node scripts/oracle/cli.ts (write | check) [<fixture glob>] | coverage";

// The compiler's sources need `--experimental-transform-types` and the `.js` to `.ts` resolve hook.
const NODE_FLAGS = [
  "--experimental-transform-types",
  "--no-warnings",
  "--import",
  fileURLToPath(new URL("../ir-models/register.ts", import.meta.url)),
];

function relaunchWithCompilerFlags(): number {
  const child = spawnSync(
    process.execPath,
    [...NODE_FLAGS, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit" },
  );

  return child.status ?? EXIT_FAILED;
}

async function run(command: string | undefined, glob: string | undefined): Promise<number> {
  if (
    (command === "write" || command === "check") &&
    glob !== undefined &&
    selectedFixtures(glob).length === 0
  ) {
    console.error(`oracle: the glob '${glob}' matches no fixture`);

    return EXIT_USAGE;
  }

  if (command === "write") {
    console.log(await writeCommand(glob));

    return EXIT_OK;
  }

  if (command === "check") {
    const result = await checkFixtures(glob);

    console.log(checkReport(result));

    return result.differing === 0 && result.problems.length === 0 ? EXIT_OK : EXIT_FAILED;
  }

  if (command === "coverage" && glob === undefined) {
    const { report, ok } = coverageCommand();

    console.log(report);

    return ok ? EXIT_OK : EXIT_FAILED;
  }

  console.error(USAGE);

  return EXIT_USAGE;
}

const [command, glob] = process.argv.slice(2);

process.exitCode = process.execArgv.includes("--experimental-transform-types")
  ? await run(command, glob)
  : relaunchWithCompilerFlags();
