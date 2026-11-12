import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CRATES_DIR, checkTraces, TRACE_FILE } from "./trace.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const EXIT_OK = 0;
const EXIT_FAILED = 1;

function main(): number {
  const problems = checkTraces(REPO_ROOT);

  for (const problem of problems) console.error(problem);

  if (problems.length > 0) {
    console.error(`trace: ${problems.length} problem(s) in ${CRATES_DIR}/*/${TRACE_FILE}`);

    return EXIT_FAILED;
  }

  console.error("trace: ok");

  return EXIT_OK;
}

process.exitCode = main();
