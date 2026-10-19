import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// Runs one command of the project's load driver and answers its JSON document.
export async function runDriver(
  projectDirectory: string,
  command: "probe" | "load",
  driverArguments: object,
): Promise<unknown> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(projectDirectory, "bench/load-driver.mts"),
      command,
      JSON.stringify(driverArguments),
    ],
    { cwd: projectDirectory, maxBuffer: MAX_OUTPUT_BYTES },
  );
  const lastLine = stdout.trim().split("\n").at(-1);

  if (lastLine === undefined)
    throw new Error(`bench: the load driver '${command}' printed nothing.`);

  return JSON.parse(lastLine);
}
