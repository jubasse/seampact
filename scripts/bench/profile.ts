import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { currentCommit, type PackedTarballs, packOnce, prepareProject } from "./bench-project.ts";
import type { BenchPair } from "./pairs.ts";
import { type CpuProfile, foldProfile, topRows } from "./profile-steps.ts";
import { runDriver } from "./run-driver.ts";
import { ServerProcess } from "./server-process.ts";

const EXIT_OK = 0;
const PROFILE_REQUESTS_FLOOR = 1;
const TOP_ROWS = 5;
const PERCENT = 100;
const MICROSECONDS_DIGITS = 1;
const PROFILE_CONNECTIONS = 10;

interface ProfileInvocation {
  readonly fresh: boolean;
  readonly out: string;
  readonly work: string;
  readonly measure: {
    readonly routeIds: readonly string[];
    readonly durationSeconds: number;
    readonly connections: number;
  };
}

// Runs each pair's seampact server under load with its CPU profiled, folds the samples into the rows of the
// check order and prints them with the microseconds each costs per request.
export async function profilePair(
  invocation: ProfileInvocation,
  pairs: readonly BenchPair[],
): Promise<number> {
  let packed: PackedTarballs | undefined;
  const tarballs = () => {
    packed ??= packOnce(invocation.work);

    return packed;
  };

  mkdirSync(invocation.out, { recursive: true });

  for (const pair of pairs) {
    const directory = prepareProject({
      pair,
      workDirectory: invocation.work,
      tarballs,
      fresh: invocation.fresh,
    });

    for (const routeId of invocation.measure.routeIds) {
      console.log(await profileRoute(pair, directory, routeId, invocation));
    }
  }

  console.log(
    `\nbench: profiles written to ${invocation.out} (commit ${currentCommit().slice(0, 8)}).`,
  );

  return EXIT_OK;
}

async function profileRoute(
  pair: BenchPair,
  directory: string,
  routeId: string,
  invocation: ProfileInvocation,
): Promise<string> {
  const server = await ServerProcess.start({
    projectDirectory: directory,
    kind: "seampact",
    baselineFramework: pair.baselineFramework,
    validators: pair.validators,
  });
  const file = join(invocation.out, `${pair.id}-${routeId}.cpuprofile`);

  try {
    await server.startProfile();

    const load = await runDriver(directory, "load", {
      baseUrl: server.baseUrl,
      routeId,
      durationSeconds: invocation.measure.durationSeconds,
      warmupSeconds: 0,
      connections: invocation.measure.connections || PROFILE_CONNECTIONS,
    });

    await server.stopProfile(file);

    const requests = Math.max(
      PROFILE_REQUESTS_FLOOR,
      Number(Reflect.get(Object(load), "requestsTotal")),
    );
    const profile: CpuProfile = JSON.parse(readFileSync(file, "utf8"));
    const rows = foldProfile(profile, requests);
    const lines = topRows(rows, TOP_ROWS).map(
      (row) =>
        `  ${row.id.padEnd(12)} ${(row.share * PERCENT).toFixed(1).padStart(5)}%  ${row.microsecondsPerRequest.toFixed(MICROSECONDS_DIGITS).padStart(7)} us/request  ${row.title}`,
    );
    const everyRow = rows
      .map((row) => `${row.id}=${row.microsecondsPerRequest.toFixed(MICROSECONDS_DIGITS)}`)
      .join(" ");

    return `\nprofile ${pair.id} ${routeId} (${requests} requests)\n${lines.join("\n")}\n  all rows (us/request): ${everyRow}`;
  } finally {
    await server.stop();
  }
}
