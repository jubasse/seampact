// Test helper: asserts a CPU-time bound, which machine load does not stretch like wall-clock time.
import { expect } from "vitest";

/** About 5x the slowest linear case alone, so loaded CPUs pass; a quadratic or exponential load needs minutes. */
export const LINEAR_CPU_BUDGET_MILLISECONDS = 30_000;

const MICROSECONDS_PER_MILLISECOND = 1000;

function cpuMilliseconds(): number {
  const { user, system } = process.cpuUsage();

  return (user + system) / MICROSECONDS_PER_MILLISECOND;
}

/** Runs `f` and fails when it used more than `ms` of CPU time: the bound a linear load stays well inside. */
export function withinCpuBudget<T>(ms: number, f: () => T): T {
  const started = cpuMilliseconds();
  const out = f();

  expect(cpuMilliseconds() - started).toBeLessThan(ms);

  return out;
}
