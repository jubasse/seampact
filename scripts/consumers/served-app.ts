// Starts a consumer app's server process on a free loopback port and waits until its control routes answer, so the
// http suite runs against the app as built; each server target's suite says how its process starts.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";

export interface RunningApp {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/** How to start one app: the command and arguments for a port, where and with what environment it runs. */
export interface ServedAppCommand {
  readonly label: string;
  readonly command: string;
  readonly args: (port: number) => readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

const READY_TIMEOUT_MS = 120_000;
const READY_POLL_MS = 250;
const READY_PATH = "/__seampact/hook-calls";
// A failed start is told by the end of the output, where the server prints the cause.
const QUOTED_OUTPUT_LENGTH = 3000;

export async function startServedApp(served: ServedAppCommand): Promise<RunningApp> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const app = spawn(served.command, [...served.args(port)], {
    cwd: served.cwd,
    env: { ...process.env, ...served.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";

  app.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  app.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });

  try {
    await waitUntilReady(app, baseUrl, served.label);
  } catch (failure) {
    await stop(app);

    throw new Error(`${String(failure)}\noutput: ${output.slice(-QUOTED_OUTPUT_LENGTH)}`);
  }

  return { baseUrl, close: () => stop(app) };
}

async function waitUntilReady(app: ChildProcess, baseUrl: string, label: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (app.exitCode !== null)
      throw new Error(`${label} exited with ${app.exitCode} before it answered`);

    if (await answers(`${baseUrl}${READY_PATH}`)) return;

    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`${label} did not answer ${READY_PATH} within ${READY_TIMEOUT_MS} ms`);
}

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);

    return response.ok;
  } catch {
    // Not listening yet: the next poll asks again.
    return false;
  }
}

async function stop(app: ChildProcess): Promise<void> {
  if (app.exitCode !== null) return;

  const exited = new Promise((resolve) => app.once("exit", resolve));

  app.kill("SIGTERM");
  await exited;
}

async function freePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  await new Promise((resolve) => server.close(resolve));

  if (address === null || typeof address === "string")
    throw new Error("no free TCP port was given");

  return address.port;
}
