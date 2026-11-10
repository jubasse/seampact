// Builds the Next.js app once (`next build`) and serves it with `next start` on a free local port, in a process of
// its own, as the http suite's server (ADR 0030): the suite runs against the production server on the Node.js runtime.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const HOST = "127.0.0.1";

export const CONSUMER_ROOT = join(import.meta.dirname, "..");
const NEXT_BIN = join(CONSUMER_ROOT, "node_modules", "next", "dist", "bin", "next");
const BUILD_ID_FILE = join(CONSUMER_ROOT, ".next", "BUILD_ID");
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 200;
// Any answer, even the contract's 404, tells the server listens.
const READY_PATH = "/v1/health";
// A start that fails tells its cause at the end of the output.
const QUOTED_OUTPUT_LENGTH = 1500;

export async function startServer(): Promise<RunningServer> {
  if (!existsSync(BUILD_ID_FILE)) await runNext(["build", "--webpack"]);

  const port = await freePort();
  const output: string[] = [];
  const child = spawn(
    process.execPath,
    [NEXT_BIN, "start", "--port", String(port), "--hostname", HOST],
    {
      cwd: CONSUMER_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    },
  );

  child.stdout.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));

  const baseUrl = `http://${HOST}:${port}`;

  await untilListening(baseUrl, child, output);

  return { baseUrl, close: () => stopped(child) };
}

/** Runs `next <args>` in [cwd] and fails with the end of its output unless it exits 0. */
export function runNext(args: readonly string[], cwd = CONSUMER_ROOT): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [NEXT_BIN, ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    const output = collectedOutput(child);

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) return resolve();

      reject(new Error(`next ${args.join(" ")} exited with ${code}:\n${quoted(output)}`));
    });
  });
}

function collectedOutput(child: ChildProcess): string[] {
  const output: string[] = [];

  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString("utf8")));

  return output;
}

function quoted(output: readonly string[]): string {
  return output.join("").slice(-QUOTED_OUTPUT_LENGTH);
}

async function untilListening(
  baseUrl: string,
  child: ChildProcess,
  output: readonly string[],
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`next start exited with ${child.exitCode}:\n${quoted(output)}`);
    }

    try {
      await fetch(`${baseUrl}${READY_PATH}`);

      return;
    } catch {
      // Not listening yet: the next poll tries again until the deadline.
      await delay(READY_POLL_MS);
    }
  }

  child.kill("SIGTERM");

  throw new Error(`next start did not listen within ${READY_TIMEOUT_MS} ms:\n${quoted(output)}`);
}

function stopped(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();

      probe.close(() => {
        if (address === null || typeof address === "string") {
          return reject(new Error("consumers: no free port"));
        }

        resolve(address.port);
      });
    });
  });
}
