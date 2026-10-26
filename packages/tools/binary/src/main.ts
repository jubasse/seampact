import { runCli } from "@seampact/cli";
import { loadFsReader } from "@seampact/compiler";
import { BINARY_NATIVE_ONLY_COMMANDS } from "./binary-refusals.js";
import { type EmbeddedPackReader, readerWithEmbeddedPacks } from "./embedded-pack-reader.js";
import { EMBEDDED_PACKS } from "./embedded-packs.js";

// The entry of the standalone binary: the CLI with the first-party packs embedded. The bundle is CommonJS, which
// has no top-level await, hence `main`.

// `yaml` prints its debug output to stdout when these are set, which would mix into the compiler's output.
const YAML_DEBUG_VARIABLES = ["LOG_STREAM", "LOG_TOKENS"];

// The reader of the source being compiled, so a diagnostic in an embedded pack names its `embedded:` copy.
let currentReader: EmbeddedPackReader | undefined;

async function main(argv: readonly string[]): Promise<number> {
  for (const variable of YAML_DEBUG_VARIABLES) delete process.env[variable];

  return runCli(argv, {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    nativeOnlyCommands: BINARY_NATIVE_ONLY_COMMANDS,
    sourceReader: (directory) => {
      currentReader = readerWithEmbeddedPacks(loadFsReader(directory), EMBEDDED_PACKS);

      return currentReader;
    },
    diagnosticFileLabel: (file) => currentReader?.embeddedLabel(file) ?? file,
  });
}

void main(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
