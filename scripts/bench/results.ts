import type { ServerKind } from "./server-process.ts";

// One load run against one server.
export interface RunSample {
  readonly requestsPerSecond: number;
  readonly latencyP50Ms: number;
  readonly latencyP99Ms: number;
  readonly requestsTotal: number;
  readonly peakRssBytes: number;
  readonly peakHeapUsedBytes: number;
  // The machine's one-minute load average when the run ended; the machine is shared, so a run reads with it.
  readonly loadAverage: number;
}

export type SamplesByServer = Readonly<Record<ServerKind, readonly RunSample[]>>;

export interface RouteMeasurement {
  readonly routeId: string;
  readonly saturation: SamplesByServer;
  // Runs at a fixed share of the lower saturation rate of the two servers, for the latency at equal load; `reached`
  // is false when a server's achieved rate fell short of `overallRate`, which makes the latencies invalid.
  readonly fixedRate: {
    readonly overallRate: number;
    readonly samples: SamplesByServer;
    readonly reached: boolean;
  };
}

export interface PairMeasurement {
  readonly pairId: string;
  readonly idleRssBytes: Readonly<Record<ServerKind, number>>;
  readonly routes: readonly RouteMeasurement[];
}

export interface BenchResults {
  readonly commit: string;
  readonly node: string;
  readonly startedAt: string;
  readonly durationSeconds: number;
  readonly repeats: number;
  readonly pairs: readonly PairMeasurement[];
}
