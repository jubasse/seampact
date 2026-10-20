import { loadavg } from "node:os";
import type { BenchPair } from "./pairs.ts";
import { runDriver } from "./run-driver.ts";
import { KINDS, ParityFailure, probeServers, startServers, stopServers } from "./run-pair.ts";
import type { ServerKind, ServerProcess } from "./server-process.ts";
import { median } from "./statistics.ts";

// The quick same-run ratio of one pair: both servers loaded at the same time, so a machine shared with other work
// slows both alike and only their ratio is read. Each repeat is one pair of runs of `durationSeconds`.

export interface RatioOptions {
  readonly routeIds: readonly string[];
  readonly durationSeconds: number;
  readonly warmupSeconds: number;
  readonly repeats: number;
  readonly connections: number;
}

/** One repeat of one route: each server's requests and the CPU time it spent on them. */
export interface RatioSample {
  readonly requests: Readonly<Record<ServerKind, number>>;
  readonly cpuMicroseconds: Readonly<Record<ServerKind, number>>;
}

export interface RouteRatio {
  /** The median of seampact's throughput over the baseline's. */
  readonly throughput: number;
  /** The median of seampact's server CPU time per request over the baseline's. */
  readonly cpuPerRequest: number;
}

const RATIO_DIGITS = 2;

export function routeRatio(samples: readonly RatioSample[]): RouteRatio {
  const unanswered = samples.find((sample) => KINDS.some((kind) => sample.requests[kind] === 0));

  if (unanswered !== undefined)
    throw new Error("bench: a ratio run where a server answered nothing.");

  return {
    throughput: median(
      samples.map((sample) => sample.requests.seampact / sample.requests.baseline),
    ),
    cpuPerRequest: median(
      samples.map(
        (sample) =>
          sample.cpuMicroseconds.seampact /
          sample.requests.seampact /
          (sample.cpuMicroseconds.baseline / sample.requests.baseline),
      ),
    ),
  };
}

// Probes the pair first and stops at any difference, then prints one line per route.
export async function ratioPair(
  pair: BenchPair,
  projectDirectory: string,
  options: RatioOptions,
): Promise<void> {
  const servers = await startServers(pair, projectDirectory);

  try {
    const differences = await probeServers(servers, projectDirectory);

    if (differences.length > 0) throw new ParityFailure(pair.id, differences);

    for (const routeId of options.routeIds) {
      const ratio = routeRatio(await ratioSamples(projectDirectory, servers, routeId, options));

      console.log(
        `ratio ${pair.id} ${routeId}: throughput ${ratio.throughput.toFixed(RATIO_DIGITS)}, cpu per request ${ratio.cpuPerRequest.toFixed(RATIO_DIGITS)} (${options.repeats} x ${options.durationSeconds} s, load average ${loadavg()[0]?.toFixed(2)})`,
      );
    }
  } finally {
    await stopServers(servers);
  }
}

async function ratioSamples(
  projectDirectory: string,
  servers: Record<ServerKind, ServerProcess>,
  routeId: string,
  options: RatioOptions,
): Promise<RatioSample[]> {
  const samples: RatioSample[] = [];

  await loadBoth(projectDirectory, servers, routeId, options, options.warmupSeconds);

  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    const cpuBefore = await cpuOfBoth(servers);
    const requests = await loadBoth(
      projectDirectory,
      servers,
      routeId,
      options,
      options.durationSeconds,
    );
    const cpuAfter = await cpuOfBoth(servers);

    samples.push({
      requests,
      cpuMicroseconds: {
        seampact: cpuAfter.seampact - cpuBefore.seampact,
        baseline: cpuAfter.baseline - cpuBefore.baseline,
      },
    });
  }

  return samples;
}

async function cpuOfBoth(
  servers: Record<ServerKind, ServerProcess>,
): Promise<Record<ServerKind, number>> {
  const [seampact, baseline] = await Promise.all([
    servers.seampact.readCpuMicroseconds(),
    servers.baseline.readCpuMicroseconds(),
  ]);

  return { seampact, baseline };
}

// Loads both servers at the same time and answers the requests each completed; any failed request stops the run.
async function loadBoth(
  projectDirectory: string,
  servers: Record<ServerKind, ServerProcess>,
  routeId: string,
  options: RatioOptions,
  durationSeconds: number,
): Promise<Record<ServerKind, number>> {
  const loadOnce = async (kind: ServerKind): Promise<number> => {
    const result = await runDriver(projectDirectory, "load", {
      baseUrl: servers[kind].baseUrl,
      routeId,
      durationSeconds,
      warmupSeconds: 0,
      connections: options.connections,
    });

    return requestsOf(kind, routeId, result);
  };
  const [seampact, baseline] = await Promise.all([loadOnce("seampact"), loadOnce("baseline")]);

  return { seampact, baseline };
}

function requestsOf(kind: ServerKind, routeId: string, result: unknown): number {
  const count = (name: string): unknown =>
    typeof result === "object" && result !== null ? Reflect.get(result, name) : undefined;
  const total = count("requestsTotal");
  const failed = ["non2xx", "errors", "timeouts"].filter((name) => count(name) !== 0);

  if (typeof total !== "number" || failed.length > 0) {
    throw new Error(
      `bench: invalid ratio run of ${kind} on ${routeId}: ${failed.join(", ") || "no request count"}.`,
    );
  }

  return total;
}
