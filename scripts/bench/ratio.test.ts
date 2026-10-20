import { describe, expect, test } from "vitest";
import { routeRatio } from "./ratio.ts";

describe("same-run ratio", () => {
  test("the throughput and CPU-per-request ratios are the medians over the repeats", () => {
    const ratio = routeRatio([
      {
        requests: { seampact: 800, baseline: 1000 },
        cpuMicroseconds: { seampact: 1600, baseline: 1000 },
      },
      {
        requests: { seampact: 900, baseline: 1000 },
        cpuMicroseconds: { seampact: 1350, baseline: 1000 },
      },
      {
        requests: { seampact: 500, baseline: 1000 },
        cpuMicroseconds: { seampact: 1500, baseline: 1000 },
      },
    ]);

    expect(ratio.throughput).toBeCloseTo(0.8);
    expect(ratio.cpuPerRequest).toBeCloseTo(2);
  });

  test("a repeat where a server answered nothing is refused", () => {
    expect(() =>
      routeRatio([
        {
          requests: { seampact: 0, baseline: 1000 },
          cpuMicroseconds: { seampact: 1, baseline: 1 },
        },
      ]),
    ).toThrow(/answered nothing/);
  });
});
