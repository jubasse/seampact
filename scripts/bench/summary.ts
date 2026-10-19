import type { BenchResults, PairMeasurement, RouteMeasurement, RunSample } from "./results.ts";
import { median, spreadShare } from "./statistics.ts";

const BYTES_PER_MEGABYTE = 1024 * 1024;
const PERCENT = 100;

const HEADER = [
  "| pair | route | req/s seampact | req/s baseline | ratio | spread | p50 ms (seampact / baseline) | p99 ms (seampact / baseline) | peak RSS MB (seampact / baseline) | idle RSS MB (seampact / baseline) | load |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
];

function medianOf(samples: readonly RunSample[], pick: (sample: RunSample) => number): number {
  return median(samples.map(pick));
}

function pair2(left: number, right: number, digits: number): string {
  return `${left.toFixed(digits)} / ${right.toFixed(digits)}`;
}

function row(pair: PairMeasurement, route: RouteMeasurement): string {
  const { seampact, baseline } = route.saturation;
  const fixed = route.fixedRate.samples;
  const seampactRate = medianOf(seampact, (sample) => sample.requestsPerSecond);
  const baselineRate = medianOf(baseline, (sample) => sample.requestsPerSecond);
  const spread = Math.max(
    spreadShare(seampact.map((sample) => sample.requestsPerSecond)),
    spreadShare(baseline.map((sample) => sample.requestsPerSecond)),
  );
  const load = Math.max(...[...seampact, ...baseline].map((sample) => sample.loadAverage));

  return [
    pair.pairId,
    route.routeId,
    seampactRate.toFixed(0),
    baselineRate.toFixed(0),
    (seampactRate / baselineRate).toFixed(2),
    `${(spread * PERCENT).toFixed(0)}%`,
    pair2(
      medianOf(fixed.seampact, (s) => s.latencyP50Ms),
      medianOf(fixed.baseline, (s) => s.latencyP50Ms),
      1,
    ),
    pair2(
      medianOf(fixed.seampact, (s) => s.latencyP99Ms),
      medianOf(fixed.baseline, (s) => s.latencyP99Ms),
      1,
    ),
    pair2(
      medianOf(seampact, (s) => s.peakRssBytes) / BYTES_PER_MEGABYTE,
      medianOf(baseline, (s) => s.peakRssBytes) / BYTES_PER_MEGABYTE,
      0,
    ),
    pair2(
      pair.idleRssBytes.seampact / BYTES_PER_MEGABYTE,
      pair.idleRssBytes.baseline / BYTES_PER_MEGABYTE,
      0,
    ),
    load.toFixed(2),
  ].join(" | ");
}

/** The Markdown table of a run: one row per pair and route, medians over the repeats. */
export function summaryTable(results: BenchResults): string {
  const rows = results.pairs.flatMap((pair) =>
    pair.routes.map((route) => `| ${row(pair, route)} |`),
  );
  const caption = `commit ${results.commit.slice(0, 8)}, node ${results.node}, ${results.durationSeconds} s runs, ${results.repeats} repeats alternating; latency at 70% of the baseline's saturation rate.`;

  return [caption, "", ...HEADER, ...rows].join("\n");
}

function keyedRates(results: BenchResults): Map<string, { rate: number; p99: number }> {
  return new Map(
    results.pairs.flatMap((pair) =>
      pair.routes.map(
        (route) =>
          [
            `${pair.pairId} ${route.routeId}`,
            {
              rate: medianOf(route.saturation.seampact, (s) => s.requestsPerSecond),
              p99: medianOf(route.fixedRate.samples.seampact, (s) => s.latencyP99Ms),
            },
          ] as const,
      ),
    ),
  );
}

/** The change of the seampact server between two runs, per pair and route: requests per second and fixed-rate p99. */
export function compareTable(before: BenchResults, after: BenchResults): string {
  const beforeRates = keyedRates(before);
  const lines = [
    `| pair route | req/s before | req/s after | change | p99 ms before | p99 ms after | change |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ];

  for (const [key, now] of keyedRates(after)) {
    const then = beforeRates.get(key);

    if (then === undefined) {
      lines.push(
        `| ${key} | not in the earlier run | ${now.rate.toFixed(0)} | | | ${now.p99.toFixed(1)} | |`,
      );
      continue;
    }

    lines.push(
      `| ${key} | ${then.rate.toFixed(0)} | ${now.rate.toFixed(0)} | ${percentChange(then.rate, now.rate)} | ${then.p99.toFixed(1)} | ${now.p99.toFixed(1)} | ${percentChange(then.p99, now.p99)} |`,
    );
  }

  return lines.join("\n");
}

function percentChange(before: number, after: number): string {
  const change = ((after - before) / before) * PERCENT;

  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}
