// The load side of a run, in the bench project where autocannon is installed; prints one JSON document.
// usage: node --import tsx bench/load-driver.mts probe '{"seampactUrl":...,"baselineUrl":...}'
//        node --import tsx bench/load-driver.mts load '{"baseUrl":...,"routeId":...,"durationSeconds":...}'
import autocannon from "autocannon";
import { type ProbeArguments, probe } from "./probe.mjs";
import type { BenchRequest } from "./route-types.mjs";
import { ALL_ROUTES, routeById } from "./routes.mjs";

interface LoadArguments {
  readonly baseUrl: string;
  readonly routeId: string;
  readonly durationSeconds: number;
  readonly warmupSeconds: number;
  readonly connections: number;
  /** Requests per second across connections; absent for a saturation run. */
  readonly overallRate?: number;
}

const PIPELINING = 1;

const [command, rawArguments] = process.argv.slice(2);

if (rawArguments === undefined)
  throw new Error("bench: load-driver takes a command and its JSON arguments.");

const parsedArguments: unknown = JSON.parse(rawArguments);

if (command === "probe")
  console.log(JSON.stringify(await probe(parsedArguments as ProbeArguments, ALL_ROUTES)));
else if (command === "load")
  console.log(JSON.stringify(await load(parsedArguments as LoadArguments)));
else throw new Error(`bench: load-driver takes 'probe' or 'load', not '${command}'.`);

async function load(options: LoadArguments): Promise<unknown> {
  const route = routeById(options.routeId);
  let serial = 0;
  const run = (durationSeconds: number, overallRate: number | undefined) =>
    autocannon({
      url: options.baseUrl,
      connections: options.connections,
      pipelining: PIPELINING,
      duration: durationSeconds,
      ...(overallRate === undefined ? {} : { overallRate }),
      requests: [
        {
          setupRequest: (request: BenchRequest) => Object.assign(request, route.request(serial++)),
        },
      ],
    });

  if (options.warmupSeconds > 0) await run(options.warmupSeconds, undefined);

  const result = await run(options.durationSeconds, options.overallRate);

  return {
    requestsPerSecond: result.requests.average,
    latencyP50Ms: result.latency.p50,
    latencyP99Ms: result.latency.p99,
    requestsTotal: result.requests.total,
    non2xx: result.non2xx,
    errors: result.errors,
    timeouts: result.timeouts,
  };
}
