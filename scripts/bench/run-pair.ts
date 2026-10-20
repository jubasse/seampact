import { loadavg } from "node:os";
import type { BenchPair } from "./pairs.ts";
import type { Placement } from "./pinning.ts";
import type { PairMeasurement, RouteMeasurement, RunSample, SamplesByServer } from "./results.ts";
import { runDriver } from "./run-driver.ts";
import { type ServerKind, ServerProcess } from "./server-process.ts";
import { median } from "./statistics.ts";

export interface MeasureOptions {
  readonly routeIds: readonly string[];
  readonly durationSeconds: number;
  readonly warmupSeconds: number;
  readonly repeats: number;
  readonly connections: number;
  /** Also run each route at a fixed rate, for the latency at equal load. */
  readonly latency: boolean;
  /** The cores the pair's servers and load driver are pinned to; unpinned when absent. */
  readonly placement?: Placement;
  /** Aborted when another pair failed: this pair stops at its next run and stops its servers. */
  readonly signal?: AbortSignal;
}

// The share of the lower of the two servers' saturation rates the fixed-rate runs send, so neither server queues.
const FIXED_RATE_SHARE = 0.7;
// A fixed-rate run whose achieved rate falls short of the rate sent by more than this share is not at equal load.
const RATE_SHORTFALL_TOLERANCE = 0.05;
const SETTLE_MS = 500;
const KINDS: readonly ServerKind[] = ["seampact", "baseline"];

interface LoadResult {
  readonly requestsPerSecond: number;
  readonly latencyP50Ms: number;
  readonly latencyP99Ms: number;
  readonly requestsTotal: number;
  readonly non2xx: number;
  readonly errors: number;
  readonly timeouts: number;
}

export class ParityFailure extends Error {
  constructor(pairId: string, differences: readonly string[]) {
    super(`bench: ${pairId} does not answer alike on both servers:\n  ${differences.join("\n  ")}`);
  }
}

// Starts both servers of a pair and answers the parity differences; none means the pair agrees.
export async function probePair(
  pair: BenchPair,
  projectDirectory: string,
  placement?: Placement,
): Promise<readonly string[]> {
  const servers = await startServers(pair, projectDirectory, placement);

  try {
    return await probeServers(servers, projectDirectory, placement);
  } finally {
    await stopServers(servers);
  }
}

async function probeServers(
  servers: Record<ServerKind, ServerProcess>,
  projectDirectory: string,
  placement?: Placement,
): Promise<readonly string[]> {
  const verdict = await runDriver(
    projectDirectory,
    "probe",
    { seampactUrl: servers.seampact.baseUrl, baselineUrl: servers.baseline.baseUrl },
    placement?.driverCpu,
  );
  const differences =
    typeof verdict === "object" && verdict !== null
      ? Reflect.get(verdict, "differences")
      : undefined;

  if (!Array.isArray(differences))
    throw new Error("bench: the probe answered no list of differences.");

  return differences.map(String);
}

// Measures every route of a pair, the two servers alternating run by run; refuses the pair at once when the
// probe finds a difference.
export async function measurePair(
  pair: BenchPair,
  projectDirectory: string,
  options: MeasureOptions,
): Promise<PairMeasurement> {
  const servers = await startServers(pair, projectDirectory, options.placement);

  try {
    const differences = await probeServers(servers, projectDirectory, options.placement);

    if (differences.length > 0) throw new ParityFailure(pair.id, differences);

    const idleRssBytes = {
      seampact: (await servers.seampact.readMemory()).rss,
      baseline: (await servers.baseline.readMemory()).rss,
    };
    const routes: RouteMeasurement[] = [];

    for (const routeId of options.routeIds) {
      routes.push(await measureRoute(pair, projectDirectory, servers, routeId, options));
    }

    return { pairId: pair.id, idleRssBytes, routes };
  } finally {
    await stopServers(servers);
  }
}

async function startServers(
  pair: BenchPair,
  projectDirectory: string,
  placement?: Placement,
): Promise<Record<ServerKind, ServerProcess>> {
  const start = (kind: ServerKind) =>
    ServerProcess.start({
      projectDirectory,
      kind,
      baselineFramework: pair.baselineFramework,
      validators: pair.validators,
      ...(placement === undefined ? {} : { cpu: placement.serverCpu }),
    });
  const seampact = await start("seampact");
  const baseline = await start("baseline");

  await settle();

  return { seampact, baseline };
}

async function stopServers(servers: Record<ServerKind, ServerProcess>): Promise<void> {
  await Promise.all(KINDS.map((kind) => servers[kind].stop()));
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

async function measureRoute(
  pair: BenchPair,
  projectDirectory: string,
  servers: Record<ServerKind, ServerProcess>,
  routeId: string,
  options: MeasureOptions,
): Promise<RouteMeasurement> {
  const saturation = await alternatingRuns(
    pair,
    projectDirectory,
    servers,
    routeId,
    options,
    undefined,
  );

  if (!options.latency) return { routeId, saturation };

  const overallRate = Math.max(
    1,
    Math.round(
      FIXED_RATE_SHARE *
        Math.min(
          median(saturation.seampact.map((sample) => sample.requestsPerSecond)),
          median(saturation.baseline.map((sample) => sample.requestsPerSecond)),
        ),
    ),
  );
  const fixedSamples = await alternatingRuns(
    pair,
    projectDirectory,
    servers,
    routeId,
    options,
    overallRate,
  );

  return {
    routeId,
    saturation,
    fixedRate: {
      overallRate,
      samples: fixedSamples,
      reached: KINDS.every((kind) => reachedRate(fixedSamples[kind], overallRate)),
    },
  };
}

function reachedRate(samples: readonly RunSample[], overallRate: number): boolean {
  const achieved = median(samples.map((sample) => sample.requestsPerSecond));

  return achieved >= overallRate * (1 - RATE_SHORTFALL_TOLERANCE);
}

async function alternatingRuns(
  pair: BenchPair,
  projectDirectory: string,
  servers: Record<ServerKind, ServerProcess>,
  routeId: string,
  options: MeasureOptions,
  overallRate: number | undefined,
): Promise<SamplesByServer> {
  const samples: Record<ServerKind, RunSample[]> = { seampact: [], baseline: [] };

  for (let repeat = 0; repeat < options.repeats; repeat += 1) {
    const order = repeat % 2 === 0 ? KINDS : [...KINDS].reverse();

    for (const kind of order) {
      options.signal?.throwIfAborted();

      samples[kind].push(
        await runOnce({
          pair,
          projectDirectory,
          server: servers[kind],
          kind,
          routeId,
          options,
          overallRate,
        }),
      );
    }
  }

  return samples;
}

async function runOnce(run: {
  readonly pair: BenchPair;
  readonly projectDirectory: string;
  readonly server: ServerProcess;
  readonly kind: ServerKind;
  readonly routeId: string;
  readonly options: MeasureOptions;
  readonly overallRate: number | undefined;
}): Promise<RunSample> {
  run.server.resetMemory();

  const result = loadResultOf(
    await runDriver(
      run.projectDirectory,
      "load",
      {
        baseUrl: run.server.baseUrl,
        routeId: run.routeId,
        durationSeconds: run.options.durationSeconds,
        warmupSeconds: run.overallRate === undefined ? run.options.warmupSeconds : 0,
        connections: run.options.connections,
        ...(run.overallRate === undefined ? {} : { overallRate: run.overallRate }),
      },
      run.options.placement?.driverCpu,
    ),
  );

  if (result.non2xx > 0 || result.errors > 0 || result.timeouts > 0) {
    throw new Error(
      `bench: invalid run of ${run.pair.id} ${run.kind} on ${run.routeId}: ${result.non2xx} non-2xx, ${result.errors} errors, ${result.timeouts} timeouts.`,
    );
  }

  const memory = await run.server.readMemory();

  return {
    requestsPerSecond: result.requestsPerSecond,
    latencyP50Ms: result.latencyP50Ms,
    latencyP99Ms: result.latencyP99Ms,
    requestsTotal: result.requestsTotal,
    peakRssBytes: memory.peakRss,
    peakHeapUsedBytes: memory.peakHeapUsed,
    loadAverage: loadavg()[0] ?? 0,
  };
}

function loadResultOf(document: unknown): LoadResult {
  if (typeof document !== "object" || document === null)
    throw new Error("bench: the load driver answered no result.");

  const member = (name: string): number => {
    const value: unknown = Reflect.get(document, name);

    if (typeof value !== "number")
      throw new Error(`bench: the load result has no number '${name}'.`);

    return value;
  };

  return {
    requestsPerSecond: member("requestsPerSecond"),
    latencyP50Ms: member("latencyP50Ms"),
    latencyP99Ms: member("latencyP99Ms"),
    requestsTotal: member("requestsTotal"),
    non2xx: member("non2xx"),
    errors: member("errors"),
    timeouts: member("timeouts"),
  };
}
