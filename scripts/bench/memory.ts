import type { BenchPair } from "./pairs.ts";
import { runDriver } from "./run-driver.ts";
import { type ServerKind, ServerProcess, type SettledMemoryReading } from "./server-process.ts";

// What a server keeps across batches of requests: after each batch of every route, a forced GC, then its heap,
// RSS and off-heap memory (anonymous RSS minus the V8 heap), one line per batch. A growth batch after batch that
// survives the GC is retained memory; the first batch also shows the warm-up.

export type MemoryServers = ServerKind | "both";

export interface MemoryOptions {
  readonly routeIds: readonly string[];
  readonly requestsPerBatch: number;
  readonly batches: number;
  readonly connections: number;
  readonly servers: MemoryServers;
}

export const MEMORY_SERVERS: readonly MemoryServers[] = ["seampact", "baseline", "both"];

const MEGABYTE = 1024 * 1024;
const NO_DURATION = 0;

export function isMemoryServers(value: string): value is MemoryServers {
  return MEMORY_SERVERS.some((servers) => servers === value);
}

export async function memoryPair(
  pair: BenchPair,
  projectDirectory: string,
  options: MemoryOptions,
): Promise<void> {
  const kinds: readonly ServerKind[] =
    options.servers === "both" ? ["seampact", "baseline"] : [options.servers];

  for (const kind of kinds) {
    const server = await ServerProcess.start({
      projectDirectory,
      kind,
      baselineFramework: pair.baselineFramework,
      validators: pair.validators,
      nodeArguments: ["--expose-gc"],
    });

    try {
      await printBatches(pair, projectDirectory, server, kind, options);
    } finally {
      await server.stop();
    }
  }
}

async function printBatches(
  pair: BenchPair,
  projectDirectory: string,
  server: ServerProcess,
  kind: ServerKind,
  options: MemoryOptions,
): Promise<void> {
  printReading(pair, kind, "start", await server.readSettledMemory());

  for (let batch = 1; batch <= options.batches; batch += 1) {
    for (const routeId of options.routeIds) {
      await runBatch(projectDirectory, server, kind, routeId, options);
    }

    printReading(pair, kind, `batch ${batch}`, await server.readSettledMemory());
  }
}

async function runBatch(
  projectDirectory: string,
  server: ServerProcess,
  kind: ServerKind,
  routeId: string,
  options: MemoryOptions,
): Promise<void> {
  const result = await runDriver(projectDirectory, "load", {
    baseUrl: server.baseUrl,
    routeId,
    durationSeconds: NO_DURATION,
    warmupSeconds: NO_DURATION,
    connections: options.connections,
    amount: options.requestsPerBatch,
  });
  const failed = ["non2xx", "errors", "timeouts"].filter(
    (name) => typeof result !== "object" || result === null || Reflect.get(result, name) !== 0,
  );

  if (failed.length > 0) {
    throw new Error(`bench: invalid memory batch of ${kind} on ${routeId}: ${failed.join(", ")}.`);
  }
}

function printReading(
  pair: BenchPair,
  kind: ServerKind,
  label: string,
  reading: SettledMemoryReading,
): void {
  const megabytes = (bytes: number) => (bytes / MEGABYTE).toFixed(1);

  console.log(
    `memory ${pair.id} ${kind} ${label}: heapUsed=${megabytes(reading.heapUsed)} rss=${megabytes(reading.rss)} offHeap=${megabytes(reading.anonymousRss - reading.heapTotal)} MB`,
  );
}
