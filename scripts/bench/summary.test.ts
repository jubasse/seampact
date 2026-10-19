import { describe, expect, test } from "vitest";
import type { BenchResults, RunSample, SamplesByServer } from "./results.ts";
import { compareTable } from "./summary.ts";

function sample(requestsPerSecond: number, latencyP99Ms: number): RunSample {
  return {
    requestsPerSecond,
    latencyP50Ms: 1,
    latencyP99Ms,
    requestsTotal: 1,
    peakRssBytes: 1,
    peakHeapUsedBytes: 1,
    loadAverage: 1,
  };
}

function samples(requestsPerSecond: number, latencyP99Ms: number): SamplesByServer {
  return {
    seampact: [sample(requestsPerSecond, latencyP99Ms)],
    baseline: [sample(requestsPerSecond, latencyP99Ms)],
  };
}

function results(latencyP99Ms: number, rateHeld: boolean): BenchResults {
  return {
    commit: "abcdef0123",
    node: "v24",
    startedAt: "now",
    durationSeconds: 1,
    repeats: 1,
    pairs: [
      {
        pairId: "pair",
        idleRssBytes: { seampact: 1, baseline: 1 },
        routes: [
          {
            routeId: "route",
            saturation: samples(100, 1),
            fixedRate: {
              overallRate: 70,
              samples: samples(70, latencyP99Ms),
              reached: rateHeld,
            },
          },
        ],
      },
    ],
  };
}

describe("compareTable", () => {
  test("shows the p99 change when both runs held the rate", () => {
    expect(compareTable(results(10, true), results(5, true))).toContain("| 10.0 | 5.0 | -50.0% |");
  });

  test("shows no p99 ratio for a run marked invalid", () => {
    const table = compareTable(results(10, true), results(500, false));

    expect(table).toContain("| 10.0 | invalid (rate not held) |  |");
    expect(table).not.toContain("+4900");
  });
});
