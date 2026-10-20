import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

function execOptions(projectDirectory: string) {
  return { cwd: projectDirectory, maxBuffer: MAX_OUTPUT_BYTES };
}

// Runs one command of the project's load driver, pinned to `cpu` when given, and answers its JSON document.
export async function runDriver(
  projectDirectory: string,
  command: "probe" | "load",
  driverArguments: object,
  cpu?: number,
): Promise<unknown> {
  const nodeArguments = [
    "--import",
    "tsx",
    join(projectDirectory, "bench/load-driver.mts"),
    command,
    JSON.stringify(driverArguments),
  ];
  const { stdout } =
    cpu === undefined
      ? await execFileAsync(process.execPath, nodeArguments, execOptions(projectDirectory))
      : await execFileAsync(
          "taskset",
          ["-c", String(cpu), process.execPath, ...nodeArguments],
          execOptions(projectDirectory),
        );
  const lastLine = stdout.trim().split("\n").at(-1);

  if (lastLine === undefined)
    throw new Error(`bench: the load driver '${command}' printed nothing.`);

  return JSON.parse(lastLine);
}
