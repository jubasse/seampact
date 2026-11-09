// Starts PHP's built-in server on the Laravel app in api/, on a free port when none is given.
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiDirectory = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "api");
const HOST = "127.0.0.1";
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 100;

export interface PhpServer {
  readonly baseUrl: string;
  readonly process: ChildProcess;
}

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();

    probe.once("error", reject);
    probe.listen(0, HOST, () => {
      const address = probe.address();

      if (typeof address !== "object" || address === null) {
        reject(new Error("The probe server does not listen on a TCP port."));

        return;
      }

      probe.close(() => resolvePort(address.port));
    });
  });
}

async function waitUntilListening(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`php -S exited with ${child.exitCode} before it listened.`);

    try {
      await fetch(`http://${HOST}:${port}/`);

      return;
    } catch {
      await new Promise((wait) => setTimeout(wait, READY_POLL_MS));
    }
  }

  throw new Error(`php -S did not listen on port ${port} within ${READY_TIMEOUT_MS} ms.`);
}

export async function startPhpServer(port: number): Promise<PhpServer> {
  const child = spawn("php", ["-S", `${HOST}:${port}`, "-t", "public"], {
    cwd: apiDirectory,
    stdio: ["ignore", "inherit", "inherit"],
  });

  try {
    await waitUntilListening(port, child);
  } catch (failure) {
    child.kill();

    throw failure;
  }

  return { baseUrl: `http://${HOST}:${port}`, process: child };
}
