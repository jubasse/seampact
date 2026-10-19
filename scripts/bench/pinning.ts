import { execFileSync } from "node:child_process";
import { availableParallelism } from "node:os";

// The cores one pair runs on: its servers on one, its load driver on another, so pairs measured side by side never
// share a core and a pair's own load driver never competes with the server it measures.
export interface Placement {
  readonly serverCpu: number;
  readonly driverCpu: number;
}

const CORES_PER_PAIR = 2;
// Pairs per core group of three: two cores each, one left for the orchestrating process and the system.
const CORES_PER_PARALLEL_PAIR = 3;

export function placementForSlot(slot: number): Placement {
  return { serverCpu: slot * CORES_PER_PAIR, driverCpu: slot * CORES_PER_PAIR + 1 };
}

export function tasksetAvailable(): boolean {
  try {
    execFileSync("taskset", ["--version"], { stdio: "ignore" });

    return true;
  } catch {
    return false;
  }
}

export function defaultParallelism(): number {
  if (!tasksetAvailable()) return 1;

  return Math.max(1, Math.floor(availableParallelism() / CORES_PER_PARALLEL_PAIR));
}

/** Refuses a parallel run that cannot pin its pairs, naming the fix. */
export function refuseUnpinnedParallelism(parallel: number): string | undefined {
  if (parallel > 1 && !tasksetAvailable()) {
    return "--parallel above 1 needs `taskset` to pin each pair to its own cores; install util-linux (it provides taskset) or run with --parallel 1.";
  }

  if (parallel * CORES_PER_PAIR > availableParallelism()) {
    return `--parallel ${parallel} needs ${parallel * CORES_PER_PAIR} cores and this machine has ${availableParallelism()}; lower --parallel.`;
  }

  return undefined;
}

// Pins every thread of a process (and so the threads it starts later) to one core.
export function pinProcess(pid: number, cpu: number): void {
  execFileSync("taskset", ["-a", "-pc", String(cpu), String(pid)], { stdio: "ignore" });
}
