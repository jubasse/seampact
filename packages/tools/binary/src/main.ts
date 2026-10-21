import { formatProblem, runCli } from "@seampact/cli";
import { loadFsReader } from "@seampact/compiler";
import { BINARY_REFUSAL_EXIT_CODE, binaryRefusal } from "./binary-refusals.js";
import { readerWithEmbeddedPacks } from "./embedded-pack-reader.js";
import { EMBEDDED_PACKS } from "./embedded-packs.js";

// The entry of the standalone binary: the CLI with the first-party packs embedded. The bundle is CommonJS, which
// has no top-level await, hence `main`.

// `yaml` prints its debug output to stdout when these are set, which would mix into the compiler's output.
const YAML_DEBUG_VARIABLES = ["LOG_STREAM", "LOG_TOKENS"];

async function main(argv: readonly string[]): Promise<number> {
  for (const variable of YAML_DEBUG_VARIABLES) delete process.env[variable];

  const refusal = binaryRefusal(argv);

  if (refusal !== undefined) {
    process.stderr.write(`${formatProblem(refusal)}\n`);

    return BINARY_REFUSAL_EXIT_CODE;
  }

  return runCli(argv, {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    sourceReader: (directory) => readerWithEmbeddedPacks(loadFsReader(directory), EMBEDDED_PACKS),
  });
}

void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
