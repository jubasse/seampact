import { type ChildProcess, fork } from "node:child_process";
import { join } from "node:path";
import { pinProcess } from "./pinning.ts";

export type ServerKind = "seampact" | "baseline";

export interface MemoryReading {
  readonly rss: number;
  readonly heapUsed: number;
  readonly peakRss: number;
  readonly peakHeapUsed: number;
}

interface ReadyMessage {
  readonly type: "ready";
  readonly baseUrl: string;
}

interface MemoryMessage extends MemoryReading {
  readonly type: "memory";
}

const BOOT_TIMEOUT_MS = 60_000;
const MEMORY_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

// A server that cannot be pinned must not keep running unpinned, nor stay behind when the run stops.
function pinOrKill(child: ChildProcess, cpu: number): void {
  try {
    if (child.pid !== undefined) pinProcess(child.pid, cpu);
  } catch (error) {
    child.kill("SIGKILL");

    throw error;
  }
}

// One server of a pair, running in a forked child of the bench project so its memory and CPU are its own.
export class ServerProcess {
  readonly baseUrl: string;
  private readonly child: ChildProcess;

  private constructor(child: ChildProcess, baseUrl: string) {
    this.child = child;
    this.baseUrl = baseUrl;
  }

  static async start(options: {
    readonly projectDirectory: string;
    readonly kind: ServerKind;
    readonly baselineFramework: string;
    readonly validators: string;
    readonly nodeArguments?: readonly string[];
    /** The core every thread of the server is pinned to. */
    readonly cpu?: number;
  }): Promise<ServerProcess> {
    const child = fork(
      join(options.projectDirectory, "bench/server-entry.mts"),
      [options.kind, options.baselineFramework],
      {
        cwd: options.projectDirectory,
        execArgv: ["--import", "tsx", ...(options.nodeArguments ?? [])],
        env: {
          ...process.env,
          BENCH_VALIDATORS: options.validators,
          // The overlay's compiler settings (NestJS decorators) apply to the bench sources too.
          TSX_TSCONFIG_PATH: join(options.projectDirectory, "bench/tsconfig.json"),
        },
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    );

    if (options.cpu !== undefined && child.pid !== undefined) pinOrKill(child, options.cpu);

    const ready = await nextMessage<ReadyMessage>(child, "ready", BOOT_TIMEOUT_MS);

    return new ServerProcess(child, ready.baseUrl);
  }

  resetMemory(): void {
    this.child.send({ type: "memory-reset" });
  }

  async readMemory(): Promise<MemoryReading> {
    const reply = nextMessage<MemoryMessage>(this.child, "memory", MEMORY_TIMEOUT_MS);

    this.child.send({ type: "memory-read" });

    return reply;
  }

  // Profiles the CPU of the server between the two calls, writing the `.cpuprofile` to `file`.
  async startProfile(): Promise<void> {
    const started = nextMessage<{ type: "profile-started" }>(
      this.child,
      "profile-started",
      MEMORY_TIMEOUT_MS,
    );

    this.child.send({ type: "profile-start" });
    await started;
  }

  async stopProfile(file: string): Promise<void> {
    const written = nextMessage<{ type: "profile-written" }>(
      this.child,
      "profile-written",
      SHUTDOWN_TIMEOUT_MS,
    );

    this.child.send({ type: "profile-stop", file });
    await written;
  }

  async stop(): Promise<void> {
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));

    this.child.send({ type: "shutdown" });
    await withTimeout(exited, SHUTDOWN_TIMEOUT_MS, "the server did not exit after shutdown");
  }
}

function nextMessage<Message extends { readonly type: string }>(
  child: ChildProcess,
  type: Message["type"],
  timeoutMs: number,
): Promise<Message> {
  const received = new Promise<Message>((resolve, reject) => {
    const onMessage = (message: unknown): void => {
      if (!isMessageOfType<Message>(message, type)) return;

      cleanup();
      resolve(message);
    };

    const onExit = (code: number | null): void => {
      cleanup();
      reject(
        new Error(`bench: the server child exited with code ${code} before sending '${type}'.`),
      );
    };

    const cleanup = (): void => {
      child.off("message", onMessage);
      child.off("exit", onExit);
    };

    child.on("message", onMessage);
    child.on("exit", onExit);
  });

  return withTimeout(received, timeoutMs, `no '${type}' message from the server child`);
}

function isMessageOfType<Message extends { readonly type: string }>(
  message: unknown,
  type: Message["type"],
): message is Message {
  return typeof message === "object" && message !== null && Reflect.get(message, "type") === type;
}

async function withTimeout<Result>(
  pending: Promise<Result>,
  timeoutMs: number,
  what: string,
): Promise<Result> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`bench: ${what} within ${timeoutMs} ms.`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
