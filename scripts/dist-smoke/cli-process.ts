import { spawn } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT } from "../golden/repo-root.ts";

// The seampact CLI from its sources, as a subprocess: its own environment, so a test sets the cache directory, the
// certificate to trust and `SEAMPACT_ALLOW_LOCAL` as a user would.

const CLI_BIN = join(REPO_ROOT, "packages/core/cli/src/bin.ts");
// Maps the sources' `.js` imports to their `.ts` files (`scripts/ir-models/register.ts`).
const SOURCE_IMPORTS_HOOK = join(REPO_ROOT, "scripts/ir-models/register.ts");
const NODE_ARGUMENTS = [
  "--experimental-transform-types",
  "--no-warnings",
  "--import",
  SOURCE_IMPORTS_HOOK,
];

export interface CliRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function runSeampact(
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<CliRun> {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [...NODE_ARGUMENTS, CLI_BIN, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", failed);
    child.on("close", (code) => done({ exitCode: code ?? -1, stdout, stderr }));
  });
}
