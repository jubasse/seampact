// The command line shared by the release scripts: arguments parsed strictly, `--root` defaulting to this
// repository, and a `ReleaseError` printed as one line with exit code 1.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { ReleaseError } from "./release-version.ts";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const EXIT_FAILURE = 1;

export const ROOT_OPTION = { root: { type: "string" } } as const;

export async function runReleaseCommand(
  name: string,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;

    console.error(`${name}: ${error.message}`);
    process.exitCode = EXIT_FAILURE;
  }
}

export function parsedArguments<Options extends ParseArgsOptionsConfig>(
  options: Options,
  usage: string,
) {
  try {
    return parseArgs({ options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new ReleaseError(
      `${error instanceof Error ? error.message : String(error)}; usage: ${usage}`,
    );
  }
}

export function repositoryRoot(rootOption: string | undefined): string {
  return rootOption === undefined ? REPOSITORY_ROOT : resolve(rootOption);
}
